import { Hono } from "hono";
import { LIMITS } from "../shared/constants";
import { nameKey } from "../shared/format";
import { retargetOp } from "../shared/ops";
import { opsRequestSchema } from "../shared/schema";
import type { Car, FuelRecord, GarageData, Op, OpsResponse, Photo, Reminder, ServiceRecord } from "../shared/types";
import { limitApi, readJson } from "./guard";
import { requireUser } from "./session";
import { ApiError, type AppEnv, type SessionUser } from "./types";

type ServiceRow = {
  id: string; car_id: string; date: string; odo: number | null; cat: string; what: string;
  place: string; sum: number; note: string; items: string;
};
type FuelRow = {
  id: string; car_id: string; date: string; odo: number; liters: number; sum: number;
  station: string; full: number; note: string;
};
type ReminderRow = {
  id: string; car_id: string; title: string; due_odo: number | null; due_date: string | null;
  done: number; done_date: string | null; notified: Reminder["notified"]; record_id: string | null;
};
export type PhotoRow = {
  id: string; car_id: string; kind: string; record_id: string | null; drive_id: string; name: string;
  mime: string; size: number; width: number | null; height: number | null; created_at: number;
};

export const photoFromRow = (r: PhotoRow): Photo => ({
  id: r.id,
  car: r.car_id,
  kind: r.kind === "record" ? "record" : "gallery",
  recordId: r.record_id,
  name: r.name,
  mime: r.mime,
  size: r.size,
  width: r.width,
  height: r.height,
  createdAt: r.created_at,
  driveId: r.drive_id,
});

/** Усі дані користувача. Кожен запит обмежено його user_id. */
export async function loadGarage(db: D1Database, userId: string, demo: number): Promise<GarageData> {
  const [cars, service, fuel, reminders, photos] = await db.batch([
    db.prepare("SELECT id, name FROM cars WHERE user_id = ? ORDER BY position, id").bind(userId),
    db.prepare("SELECT * FROM service_records WHERE user_id = ?").bind(userId),
    db.prepare("SELECT * FROM fuel_records WHERE user_id = ?").bind(userId),
    db.prepare("SELECT * FROM reminders WHERE user_id = ?").bind(userId),
    db.prepare("SELECT * FROM photos WHERE user_id = ?").bind(userId),
  ]);
  return {
    demo: demo === 1,
    cars: cars.results as Car[],
    service: (service.results as ServiceRow[]).map(
      (r): ServiceRecord => ({
        id: r.id,
        car: r.car_id,
        date: r.date,
        odo: r.odo,
        cat: r.cat,
        what: r.what,
        where: r.place,
        sum: r.sum,
        note: r.note,
        items: JSON.parse(r.items),
      }),
    ),
    fuel: (fuel.results as FuelRow[]).map(
      (r): FuelRecord => ({
        id: r.id,
        car: r.car_id,
        date: r.date,
        odo: r.odo,
        liters: r.liters,
        sum: r.sum,
        station: r.station,
        full: r.full === 1,
        note: r.note,
      }),
    ),
    reminders: (reminders.results as ReminderRow[]).map(
      (r): Reminder => ({
        id: r.id,
        car: r.car_id,
        title: r.title,
        dueOdo: r.due_odo,
        dueDate: r.due_date,
        done: r.done === 1,
        doneDate: r.done_date,
        notified: r.notified,
        recordId: r.record_id,
      }),
    ),
    photos: (photos.results as PhotoRow[]).map(photoFromRow),
  };
}

/** Запис переїхав на іншу машину: фото й нагадування їдуть разом із ним. */
const moveLinked = (db: D1Database, userId: string, recordId: string, car: string): D1PreparedStatement[] => [
  db
    .prepare("UPDATE photos SET car_id = ?1 WHERE user_id = ?2 AND record_id = ?3 AND car_id <> ?1")
    .bind(car, userId, recordId),
  db
    .prepare("UPDATE reminders SET car_id = ?1 WHERE user_id = ?2 AND record_id = ?3 AND car_id <> ?1")
    .bind(car, userId, recordId),
];

const opStatements = (db: D1Database, userId: string, op: Op): D1PreparedStatement[] => {
  switch (op.type) {
    case "car.put":
      return [
        db
          .prepare(
            `INSERT INTO cars (user_id, id, name, name_key, position)
             VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(position), 0) + 1 FROM cars WHERE user_id = ?1))
             ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key`,
          )
          .bind(userId, op.data.id, op.data.name, nameKey(op.data.name)),
      ];
    case "car.del":
      return [db.prepare("DELETE FROM cars WHERE user_id = ? AND id = ?").bind(userId, op.id)];
    case "service.put": {
      const r = op.data;
      return [
        db
          .prepare(
            `INSERT INTO service_records (user_id, id, car_id, date, odo, cat, what, place, sum, note, items)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (user_id, id) DO UPDATE SET
               car_id = excluded.car_id, date = excluded.date, odo = excluded.odo, cat = excluded.cat,
               what = excluded.what, place = excluded.place, sum = excluded.sum, note = excluded.note,
               items = excluded.items`,
          )
          .bind(userId, r.id, r.car, r.date, r.odo, r.cat, r.what, r.where, r.sum, r.note, JSON.stringify(r.items)),
        ...moveLinked(db, userId, r.id, r.car),
      ];
    }
    case "service.del":
      return [
        db.prepare("DELETE FROM service_records WHERE user_id = ? AND id = ?").bind(userId, op.id),
        db.prepare("DELETE FROM photos WHERE user_id = ? AND record_id = ?").bind(userId, op.id),
      ];
    case "fuel.put": {
      const r = op.data;
      return [
        db
          .prepare(
            `INSERT INTO fuel_records (user_id, id, car_id, date, odo, liters, sum, station, full, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (user_id, id) DO UPDATE SET
               car_id = excluded.car_id, date = excluded.date, odo = excluded.odo, liters = excluded.liters,
               sum = excluded.sum, station = excluded.station, full = excluded.full, note = excluded.note`,
          )
          .bind(userId, r.id, r.car, r.date, r.odo, r.liters, r.sum, r.station, r.full ? 1 : 0, r.note),
        ...moveLinked(db, userId, r.id, r.car),
      ];
    }
    case "fuel.del":
      return [
        db.prepare("DELETE FROM fuel_records WHERE user_id = ? AND id = ?").bind(userId, op.id),
        db.prepare("DELETE FROM photos WHERE user_id = ? AND record_id = ?").bind(userId, op.id),
      ];
    case "reminder.put": {
      const r = op.data;
      return [
        db
          .prepare(
            `INSERT INTO reminders (user_id, id, car_id, title, due_odo, due_date, done, done_date, notified, record_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (user_id, id) DO UPDATE SET
               car_id = excluded.car_id, title = excluded.title, due_odo = excluded.due_odo,
               due_date = excluded.due_date, done = excluded.done, done_date = excluded.done_date,
               notified = excluded.notified, record_id = excluded.record_id`,
          )
          .bind(userId, r.id, r.car, r.title, r.dueOdo, r.dueDate, r.done ? 1 : 0, r.doneDate, r.notified, r.recordId),
      ];
    }
    case "reminder.del":
      return [db.prepare("DELETE FROM reminders WHERE user_id = ? AND id = ?").bind(userId, op.id)];
    case "demo.set":
      return [db.prepare("UPDATE users SET demo = ? WHERE id = ?").bind(op.value ? 1 : 0, userId)];
    case "all.del":
      return [
        db.prepare("DELETE FROM cars WHERE user_id = ?").bind(userId),
        db.prepare("UPDATE users SET demo = 0 WHERE id = ?").bind(userId),
      ];
  }
};

/** Межі на користувача: база має рости повільно, навіть якщо хтось напише скрипт. */
function checkQuota(user: SessionUser, ops: Op[]): void {
  const adds = { car: 0, service: 0, fuel: 0, reminder: 0 };
  for (const op of ops) {
    if (op.type === "car.put") adds.car++;
    if (op.type === "service.put") adds.service++;
    if (op.type === "fuel.put") adds.fuel++;
    if (op.type === "reminder.put") adds.reminder++;
  }
  // Запас на один запит: оновлення наявних записів теж рахуються як додавання.
  if (
    (adds.car && user.cars_count + adds.car > LIMITS.cars + LIMITS.opsPerRequest) ||
    (adds.service && user.service_count + adds.service > LIMITS.service + LIMITS.opsPerRequest) ||
    (adds.fuel && user.fuel_count + adds.fuel > LIMITS.fuel + LIMITS.opsPerRequest) ||
    (adds.reminder && user.reminders_count + adds.reminder > LIMITS.reminders + LIMITS.opsPerRequest)
  ) {
    throw new ApiError(413, "Достигнут лимит записей на аккаунт.");
  }
}

type IndexedOp = { op: Op; index: number };

/**
 * Дві машини з однаковою назвою бути не може, але два пристрої без мережі могли створити їх незалежно.
 * Нова машина з уже наявною назвою зливається з нею, а її записи переходять туди ж, а не губляться.
 * Перейменування наявної машини на зайняту назву лишається помилкою.
 */
async function mergeDuplicateCars(
  db: D1Database,
  userId: string,
  ops: Op[],
): Promise<{ ops: IndexedOp[]; remapped: Map<string, string> }> {
  const indexed = ops.map((op, index) => ({ op, index }));
  const remapped = new Map<string, string>();
  if (!ops.some((op) => op.type === "car.put")) return { ops: indexed, remapped };

  const { results } = await db
    .prepare("SELECT id, name_key FROM cars WHERE user_id = ?")
    .bind(userId)
    .all<{ id: string; name_key: string }>();
  const idByName = new Map(results.map((r) => [r.name_key, r.id]));
  const knownIds = new Set(results.map((r) => r.id));

  const out: IndexedOp[] = [];
  for (const { op, index } of indexed) {
    if (op.type === "all.del") {
      idByName.clear();
      knownIds.clear();
    }
    if (op.type === "car.del") {
      knownIds.delete(op.id);
      for (const [name, id] of idByName) if (id === op.id) idByName.delete(name);
    }
    if (op.type === "car.put") {
      const key = nameKey(op.data.name);
      const existing = idByName.get(key);
      if (existing && existing !== op.data.id && !knownIds.has(op.data.id)) {
        remapped.set(op.data.id, existing);
        continue;
      }
      if (!existing) idByName.set(key, op.data.id);
      knownIds.add(op.data.id);
    }
    out.push({ op: retargetOp(op, remapped), index });
  }
  return { ops: out, remapped };
}

const isConstraintError = (err: unknown): boolean => /constraint/i.test(String(err));
const DB_DOWN = "База временно недоступна. Попробуй позже.";

export const data = new Hono<AppEnv>();

data.post("/ops", requireUser, async (c) => {
  const user = c.get("user");
  await limitApi(c, `ops:${user.id}`);
  const parsed = await readJson(c, opsRequestSchema, 2 * 1024 * 1024);
  checkQuota(user, parsed.ops);

  const db = c.env.DB;
  const { ops, remapped } = await mergeDuplicateCars(db, user.id, parsed.ops);
  const respond = (rejected: number[]) =>
    c.json({ rejected, remapped: Object.fromEntries(remapped) } satisfies OpsResponse);

  const statements = ops.map(({ op }) => opStatements(db, user.id, op));
  if (!statements.length) return respond([]);
  try {
    await db.batch(statements.flat());
    return respond([]);
  } catch (err) {
    // Збій бази — не привід відкидати дані: клієнт повторить запит пізніше.
    if (!isConstraintError(err)) throw new ApiError(503, DB_DOWN);

    // Одна операція (наприклад, запис для вже видаленої машини) не має блокувати решту черги.
    const rejected: number[] = [];
    for (let i = 0; i < statements.length; i++) {
      try {
        await db.batch(statements[i]);
      } catch (inner) {
        if (!isConstraintError(inner)) throw new ApiError(503, DB_DOWN);
        rejected.push(ops[i].index);
      }
    }
    return respond(rejected);
  }
});
