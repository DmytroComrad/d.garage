import { Hono } from "hono";
import { LIMITS } from "../shared/constants";
import { nameKey } from "../shared/format";
import { opsRequestSchema } from "../shared/schema";
import type { Car, FuelRecord, GarageData, Op, Photo, Reminder, ServiceRecord } from "../shared/types";
import { limitApi, readJson } from "./guard";
import { requireUser } from "./session";
import { ApiError, type AppEnv } from "./types";

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
  done: number; done_date: string | null; notified: number; record_id: string | null;
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
        notified: (r.notified as Reminder["notified"]) ?? 0,
        recordId: r.record_id,
      }),
    ),
    photos: (photos.results as PhotoRow[]).map(photoFromRow),
  };
}

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
async function checkQuota(db: D1Database, userId: string, ops: Op[]): Promise<void> {
  const adds = { car: 0, service: 0, fuel: 0, reminder: 0 };
  for (const op of ops) {
    if (op.type === "car.put") adds.car++;
    if (op.type === "service.put") adds.service++;
    if (op.type === "fuel.put") adds.fuel++;
    if (op.type === "reminder.put") adds.reminder++;
  }
  if (!adds.car && !adds.service && !adds.fuel && !adds.reminder) return;

  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM cars WHERE user_id = ?1) AS cars,
              (SELECT COUNT(*) FROM service_records WHERE user_id = ?1) AS service,
              (SELECT COUNT(*) FROM fuel_records WHERE user_id = ?1) AS fuel,
              (SELECT COUNT(*) FROM reminders WHERE user_id = ?1) AS reminders`,
    )
    .bind(userId)
    .first<{ cars: number; service: number; fuel: number; reminders: number }>();
  if (!row) return;
  if (
    row.cars + adds.car > LIMITS.cars + LIMITS.opsPerRequest ||
    row.service + adds.service > LIMITS.service ||
    row.fuel + adds.fuel > LIMITS.fuel ||
    row.reminders + adds.reminder > LIMITS.reminders
  ) {
    throw new ApiError(413, "Достигнут лимит записей на аккаунт.");
  }
}

const isConstraintError = (err: unknown): boolean => /constraint/i.test(String(err));

export const data = new Hono<AppEnv>();

data.post("/ops", requireUser, async (c) => {
  const user = c.get("user");
  await limitApi(c, `ops:${user.id}`);
  const { ops } = await readJson(c, opsRequestSchema, 2 * 1024 * 1024);
  await checkQuota(c.env.DB, user.id, ops as Op[]);

  const db = c.env.DB;
  const statements = (ops as Op[]).map((op) => opStatements(db, user.id, op));
  try {
    await db.batch(statements.flat());
    return c.json({ rejected: [] as number[] });
  } catch (err) {
    // Збій бази — не привід відкидати дані: клієнт повторить запит пізніше.
    if (!isConstraintError(err)) throw new ApiError(503, "База временно недоступна. Попробуй позже.");

    // Одна операція (наприклад, запис для вже видаленої машини) не має блокувати решту черги.
    const rejected: number[] = [];
    for (let i = 0; i < statements.length; i++) {
      try {
        await db.batch(statements[i]);
      } catch (inner) {
        if (!isConstraintError(inner)) throw new ApiError(503, "База временно недоступна. Попробуй позже.");
        rejected.push(i);
      }
    }
    return c.json({ rejected });
  }
});
