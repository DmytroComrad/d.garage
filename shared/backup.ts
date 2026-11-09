import { BACKUP_APP, LEGACY_BACKUP_APPS, LIMITS, OTHER_CATEGORY } from "./constants";
import { genId, nameKey } from "./format";
import { isHttpUrl, isIsoDate } from "./parse";
import type { Backup, Car, FuelRecord, GarageData, Reminder, ServiceItem, ServiceRecord, Wish } from "./types";

type BackupSource = Pick<GarageData, "cars" | "service" | "fuel" | "reminders" | "wishes">;

export function buildBackup(data: BackupSource, carId?: string): Backup {
  const only = <T extends { car: string }>(list: T[]) => (carId ? list.filter((r) => r.car === carId) : list);
  return {
    app: BACKUP_APP,
    v: 3,
    saved: new Date().toISOString(),
    cars: carId ? data.cars.filter((c) => c.id === carId) : data.cars,
    service: only(data.service),
    fuel: only(data.fuel),
    reminders: only(data.reminders),
    wishes: only(data.wishes),
  };
}

export const backupFileName = (today: string, carName?: string): string => {
  if (!carName) return `d-garage-backup-${today}.txt`;
  const safe = carName.replace(/[\\/:*?"<>|]+/g, "").trim().replace(/\s+/g, "-") || "car";
  return `d-garage-backup-${safe}-${today}.txt`;
};

export const backupToText = (backup: Backup): string => JSON.stringify(backup, null, 2);

export type RawBackup = {
  cars: unknown[];
  service?: unknown[];
  fuel?: unknown[];
  reminders?: unknown[];
  wishes?: unknown[];
};

/** Код помилки, а не текст: текст обирає інтерфейс своєю мовою. */
export type BackupError = "corrupted" | "notBackup";
export type ParsedBackup = { ok: true; backup: RawBackup } | { ok: false; error: BackupError };

const KNOWN_APPS: readonly unknown[] = [BACKUP_APP, ...LEGACY_BACKUP_APPS];

export function parseBackupText(text: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, "").trim());
  } catch {
    return { ok: false, error: "corrupted" };
  }
  const obj = parsed as Partial<Record<string, unknown>> | null;
  if (
    !obj ||
    typeof obj !== "object" ||
    !KNOWN_APPS.includes(obj.app) ||
    !Array.isArray(obj.cars) ||
    (obj.service !== undefined && !Array.isArray(obj.service)) ||
    (obj.fuel !== undefined && !Array.isArray(obj.fuel))
  ) {
    return { ok: false, error: "notBackup" };
  }
  return { ok: true, backup: obj as unknown as RawBackup };
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const kopecks = (v: number): number => Math.round(v * 100);

/** Сума в межах, які приймає сервер. */
const money = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= 0 && n <= LIMITS.maxSum ? n : null;
};

/** Ціна хотілки з бекапу: верхня межа лише тоді, коли вона справді більша за нижню. */
const priceRange = (rawPrice: unknown, rawMax: unknown): Pick<Wish, "price" | "priceMax"> => {
  const price = rawPrice == null || rawPrice === "" ? null : money(rawPrice);
  const max = rawMax == null || rawMax === "" ? null : money(rawMax);
  return { price, priceMax: price != null && max != null && max > price ? max : null };
};

/** Пробіг у межах сервера: порожньо → null, сміття → undefined. */
const odometer = (v: unknown): number | null | undefined => {
  if (v == null || v === "") return null;
  const n = num(v);
  if (n == null || n < 0 || n > LIMITS.maxOdo) return undefined;
  return Math.round(n);
};

const dupKey = (type: string, date: string, carName: string, odo: number | null, sum: number): string =>
  [type, date, nameKey(carName), odo ?? "", kopecks(sum)].join("|");

const reminderKey = (carName: string, title: string, dueOdo: number | null, dueDate: string | null): string =>
  [nameKey(carName), nameKey(title), dueOdo ?? "", dueDate ?? ""].join("|");

const wishKey = (carName: string, title: string): string => [nameKey(carName), nameKey(title)].join("|");

export type MergeResult = {
  cars: Car[];
  service: ServiceRecord[];
  fuel: FuelRecord[];
  reminders: Reminder[];
  wishes: Wish[];
  added: number;
  skipped: number;
};

/**
 * Відновлення зливає дані, а не замінює (п. 3.9):
 * машини зіставляються за назвою без регістру, записи отримують нові id,
 * дублікат = збіг типу, дати, назви машини, пробігу і суми в копійках.
 * Межі ті самі, що на сервері: те, що він відхилить, не рахується доданим.
 */
export function mergeBackup(
  current: BackupSource,
  backup: RawBackup,
  makeId: () => string = genId,
  today: string = new Date().toISOString().slice(0, 10),
): MergeResult {
  const carsByKey = new Map(current.cars.map((c) => [nameKey(c.name), c]));
  const nameById = new Map(current.cars.map((c) => [c.id, c.name]));
  const newCars: Car[] = [];

  // id машини в бекапі → наша машина
  const backupCars = new Map<string, Car>();
  for (const raw of backup.cars) {
    const r = raw as Record<string, unknown>;
    const name = str(r?.name, LIMITS.carNameLength);
    const backupId = str(r?.id, 200);
    if (!name) continue;
    let car = carsByKey.get(nameKey(name));
    if (!car) {
      car = { id: makeId(), name };
      carsByKey.set(nameKey(name), car);
      newCars.push(car);
    }
    if (backupId) backupCars.set(backupId, car);
  }

  const seen = new Set<string>();
  for (const r of current.service) seen.add(dupKey("s", r.date, nameById.get(r.car) ?? "", r.odo, r.sum));
  for (const r of current.fuel) seen.add(dupKey("f", r.date, nameById.get(r.car) ?? "", r.odo, r.sum));
  const seenReminders = new Set(
    current.reminders.map((r) => reminderKey(nameById.get(r.car) ?? "", r.title, r.dueOdo, r.dueDate)),
  );

  const service: ServiceRecord[] = [];
  const fuel: FuelRecord[] = [];
  const reminders: Reminder[] = [];
  const recordIdMap = new Map<string, string>();
  let added = 0;
  let skipped = 0;

  for (const raw of backup.service ?? []) {
    const r = raw as Record<string, unknown>;
    const car = backupCars.get(str(r?.car, 200));
    const sum = money(r?.sum);
    const what = str(r?.what, LIMITS.whatLength) || str(r?.cat, LIMITS.whatLength);
    const odo = odometer(r?.odo);
    if (!car || !isIsoDate(r?.date) || sum == null || !what || odo === undefined) {
      skipped++;
      continue;
    }
    const key = dupKey("s", r.date, car.name, odo, sum);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const id = makeId();
    if (str(r.id, 200)) recordIdMap.set(str(r.id, 200), id);
    const items: ServiceItem[] = Array.isArray(r.items)
      ? (r.items as Record<string, unknown>[]).slice(0, LIMITS.itemsPerRecord).flatMap((it) => {
          const itemSum = money(it?.sum);
          if (itemSum == null) return [];
          const kind: ServiceItem["kind"] = it.kind === "parts" || it.kind === "labor" ? it.kind : "extra";
          return [{ id: makeId(), kind, name: str(it.name, LIMITS.itemNameLength), sum: itemSum }];
        })
      : [];
    service.push({
      id,
      car: car.id,
      date: r.date,
      odo,
      cat: str(r.cat, LIMITS.categoryLength) || OTHER_CATEGORY,
      what,
      where: str(r.where, LIMITS.placeLength),
      sum,
      note: str(r.note, LIMITS.noteLength),
      items,
    });
    added++;
  }

  for (const raw of backup.fuel ?? []) {
    const r = raw as Record<string, unknown>;
    const car = backupCars.get(str(r?.car, 200));
    const sum = money(r?.sum);
    const liters = num(r?.liters);
    const odo = odometer(r?.odo);
    if (
      !car ||
      !isIsoDate(r?.date) ||
      !sum ||
      liters == null ||
      liters <= 0 ||
      liters > LIMITS.maxLiters ||
      odo == null
    ) {
      skipped++;
      continue;
    }
    const key = dupKey("f", r.date, car.name, odo, sum);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const id = makeId();
    if (str(r.id, 200)) recordIdMap.set(str(r.id, 200), id);
    fuel.push({
      id,
      car: car.id,
      date: r.date,
      odo,
      liters,
      sum,
      station: str(r.station, LIMITS.placeLength),
      full: r.full !== false,
      note: str(r.note, LIMITS.noteLength),
    });
    added++;
  }

  for (const raw of backup.reminders ?? []) {
    const r = raw as Record<string, unknown>;
    const car = backupCars.get(str(r?.car, 200));
    const dueOdo = odometer(r?.dueOdo);
    const dueDate = isIsoDate(r?.dueDate) ? r.dueDate : null;
    if (!car || dueOdo === undefined || (dueOdo == null && dueDate == null)) {
      skipped++;
      continue;
    }
    const title = str(r.title, LIMITS.titleLength);
    const key = reminderKey(car.name, title, dueOdo, dueDate);
    if (seenReminders.has(key)) {
      skipped++;
      continue;
    }
    seenReminders.add(key);
    reminders.push({
      id: makeId(),
      car: car.id,
      title,
      dueOdo,
      dueDate,
      done: r.done === true,
      doneDate: isIsoDate(r.doneDate) ? r.doneDate : null,
      notified: 0,
      recordId: recordIdMap.get(str(r.recordId, 200)) ?? null,
    });
    added++;
  }

  const seenWishes = new Set(current.wishes.map((w) => wishKey(nameById.get(w.car) ?? "", w.title)));
  const wishes: Wish[] = [];
  for (const raw of backup.wishes ?? []) {
    const r = raw as Record<string, unknown>;
    const car = backupCars.get(str(r?.car, 200));
    const title = str(r?.title, LIMITS.titleLength);
    if (!car || !title) {
      skipped++;
      continue;
    }
    const key = wishKey(car.name, title);
    if (seenWishes.has(key)) {
      skipped++;
      continue;
    }
    seenWishes.add(key);
    const done = r.done === true;
    wishes.push({
      id: makeId(),
      car: car.id,
      title,
      ...priceRange(r.price, r.priceMax),
      links: (Array.isArray(r.links) ? r.links : [])
        .map((l) => (typeof l === "string" ? l.trim() : ""))
        .filter(isHttpUrl)
        .slice(0, LIMITS.linksPerWish),
      note: str(r.note, LIMITS.noteLength),
      added: isIsoDate(r.added) ? r.added : today,
      done,
      doneDate: done && isIsoDate(r.doneDate) ? r.doneDate : null,
      recordId: recordIdMap.get(str(r.recordId, 200)) ?? null,
    });
    added++;
  }

  return { cars: newCars, service, fuel, reminders, wishes, added, skipped };
}
