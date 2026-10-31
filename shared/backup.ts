import { BACKUP_APP, LIMITS } from "./constants";
import { genId, nameKey } from "./format";
import type { Backup, Car, FuelRecord, GarageData, Reminder, ServiceItem, ServiceRecord } from "./types";

type BackupSource = Pick<GarageData, "cars" | "service" | "fuel" | "reminders">;

export function buildBackup(data: BackupSource, carId?: string): Backup {
  const only = <T extends { car: string }>(list: T[]) => (carId ? list.filter((r) => r.car === carId) : list);
  return {
    app: BACKUP_APP,
    v: 2,
    saved: new Date().toISOString(),
    cars: carId ? data.cars.filter((c) => c.id === carId) : data.cars,
    service: only(data.service),
    fuel: only(data.fuel),
    reminders: only(data.reminders),
  };
}

export const backupFileName = (today: string, carName?: string): string => {
  if (!carName) return `garage-backup-${today}.txt`;
  const safe = carName.replace(/[\\/:*?"<>|]+/g, "").trim().replace(/\s+/g, "-") || "car";
  return `garage-backup-${safe}-${today}.txt`;
};

export const backupToText = (backup: Backup): string => JSON.stringify(backup, null, 2);

export const BACKUP_ERRORS = {
  corrupted: "Не получилось прочитать бэкап — текст обрезан или повреждён.",
  notBackup: "Это не похоже на бэкап гаража.",
  file: "Не получилось прочитать файл.",
} as const;

export type RawBackup = {
  cars: unknown[];
  service?: unknown[];
  fuel?: unknown[];
  reminders?: unknown[];
};

export type ParsedBackup = { ok: true; backup: RawBackup } | { ok: false; error: string };

export function parseBackupText(text: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, "").trim());
  } catch {
    return { ok: false, error: BACKUP_ERRORS.corrupted };
  }
  const obj = parsed as Partial<Record<string, unknown>> | null;
  if (
    !obj ||
    typeof obj !== "object" ||
    obj.app !== BACKUP_APP ||
    !Array.isArray(obj.cars) ||
    (obj.service !== undefined && !Array.isArray(obj.service)) ||
    (obj.fuel !== undefined && !Array.isArray(obj.fuel))
  ) {
    return { ok: false, error: BACKUP_ERRORS.notBackup };
  }
  return { ok: true, backup: obj as unknown as RawBackup };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const kopecks = (v: number): number => Math.round(v * 100);

const dupKey = (type: string, date: string, carName: string, odo: number | null, sum: number): string =>
  [type, date, nameKey(carName), odo ?? "", kopecks(sum)].join("|");

const reminderKey = (carName: string, title: string, dueOdo: number | null, dueDate: string | null): string =>
  [nameKey(carName), nameKey(title), dueOdo ?? "", dueDate ?? ""].join("|");

export type MergeResult = {
  cars: Car[];
  service: ServiceRecord[];
  fuel: FuelRecord[];
  reminders: Reminder[];
  added: number;
  skipped: number;
};

/**
 * Відновлення зливає дані, а не замінює (п. 3.9):
 * машини зіставляються за назвою без регістру, записи отримують нові id,
 * дублікат = збіг типу, дати, назви машини, пробігу і суми в копійках.
 */
export function mergeBackup(current: BackupSource, backup: RawBackup, makeId: () => string = genId): MergeResult {
  const carsByKey = new Map(current.cars.map((c) => [nameKey(c.name), c]));
  const nameById = new Map(current.cars.map((c) => [c.id, c.name]));
  const newCars: Car[] = [];

  // id машини в бекапі → наша машина
  const backupCars = new Map<string, Car>();
  for (const raw of backup.cars) {
    const r = raw as Record<string, unknown>;
    const name = str(r?.name).slice(0, LIMITS.carNameLength);
    const backupId = str(r?.id);
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
    const car = backupCars.get(str(r?.car));
    const sum = num(r?.sum);
    const what = str(r?.what) || str(r?.cat);
    if (!car || !isDate(r?.date) || sum == null || sum < 0 || !what) {
      skipped++;
      continue;
    }
    const odoRaw = r.odo == null || r.odo === "" ? null : num(r.odo);
    const odo = odoRaw == null ? null : Math.round(odoRaw);
    const key = dupKey("s", r.date, car.name, odo, sum);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const id = makeId();
    if (str(r.id)) recordIdMap.set(str(r.id), id);
    const items: ServiceItem[] = Array.isArray(r.items)
      ? (r.items as Record<string, unknown>[]).slice(0, LIMITS.itemsPerRecord).flatMap((it) => {
          const itemSum = num(it?.sum);
          if (itemSum == null || itemSum < 0) return [];
          const kind = it.kind === "parts" || it.kind === "labor" ? it.kind : "extra";
          return [{ id: makeId(), kind, name: str(it.name).slice(0, LIMITS.itemNameLength), sum: itemSum } as ServiceItem];
        })
      : [];
    service.push({
      id,
      car: car.id,
      date: r.date,
      odo,
      cat: (str(r.cat) || "Другое").slice(0, 80),
      what: what.slice(0, LIMITS.whatLength),
      where: str(r.where).slice(0, LIMITS.placeLength),
      sum,
      note: str(r.note).slice(0, LIMITS.noteLength),
      items,
    });
    added++;
  }

  for (const raw of backup.fuel ?? []) {
    const r = raw as Record<string, unknown>;
    const car = backupCars.get(str(r?.car));
    const sum = num(r?.sum);
    const liters = num(r?.liters);
    const odoRaw = num(r?.odo);
    if (!car || !isDate(r?.date) || sum == null || sum <= 0 || liters == null || liters <= 0 || odoRaw == null) {
      skipped++;
      continue;
    }
    const odo = Math.round(odoRaw);
    const key = dupKey("f", r.date, car.name, odo, sum);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const id = makeId();
    if (str(r.id)) recordIdMap.set(str(r.id), id);
    fuel.push({
      id,
      car: car.id,
      date: r.date,
      odo,
      liters,
      sum,
      station: str(r.station).slice(0, LIMITS.placeLength),
      full: r.full !== false,
      note: str(r.note).slice(0, LIMITS.noteLength),
    });
    added++;
  }

  for (const raw of backup.reminders ?? []) {
    const r = raw as Record<string, unknown>;
    const car = backupCars.get(str(r?.car));
    const dueOdoRaw = r?.dueOdo == null ? null : num(r.dueOdo);
    const dueOdo = dueOdoRaw == null ? null : Math.round(dueOdoRaw);
    const dueDate = isDate(r?.dueDate) ? r.dueDate : null;
    if (!car || (dueOdo == null && dueDate == null)) {
      skipped++;
      continue;
    }
    const title = str(r.title).slice(0, 200);
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
      doneDate: isDate(r.doneDate) ? r.doneDate : null,
      notified: 0,
      recordId: recordIdMap.get(str(r.recordId)) ?? null,
    });
    added++;
  }

  return { cars: newCars, service, fuel, reminders, added, skipped };
}
