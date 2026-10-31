import { describe, expect, it } from "vitest";
import { BACKUP_ERRORS, backupFileName, backupToText, buildBackup, mergeBackup, parseBackupText } from "../../shared/backup";
import { emptyData } from "../../shared/ops";
import { CAR, fuel, service } from "./fixtures";

const data = { ...emptyData(), cars: [{ id: CAR, name: "Тест" }], service, fuel };
let counter = 0;
const nextId = () => `id${++counter}`;

describe("файл бекапу", () => {
  it("зберігається в .txt", () => {
    expect(backupFileName("2026-09-15")).toBe("garage-backup-2026-09-15.txt");
    expect(backupFileName("2026-09-15", "Моя машина")).toBe("garage-backup-Моя-машина-2026-09-15.txt");
  });

  it("читається назад із тексту, навіть з BOM", () => {
    const text = `﻿${backupToText(buildBackup(data))}`;
    const parsed = parseBackupText(text);
    expect(parsed.ok).toBe(true);
  });

  it("помилки з тз", () => {
    expect(parseBackupText("{обрізано")).toEqual({ ok: false, error: BACKUP_ERRORS.corrupted });
    expect(parseBackupText('{"a":1}')).toEqual({ ok: false, error: BACKUP_ERRORS.notBackup });
  });

  it("лише одна машина", () => {
    const two = { ...data, cars: [...data.cars, { id: "x", name: "Інша" }] };
    const only = buildBackup(two, "x");
    expect(only.cars).toHaveLength(1);
    expect(only.service).toHaveLength(0);
  });
});

describe("злиття", () => {
  const backup = buildBackup(data);

  it("у порожній гараж додає все з новими id", () => {
    const res = mergeBackup(emptyData(), backup, nextId);
    expect(res.added).toBe(5);
    expect(res.skipped).toBe(0);
    expect(res.cars).toHaveLength(1);
    expect(res.service.map((r) => r.id)).not.toContain("s1");
    expect(res.service[0].car).toBe(res.cars[0].id);
  });

  it("повторне відновлення того самого бекапу додає 0", () => {
    const res = mergeBackup(data, backup, nextId);
    expect(res.added).toBe(0);
    expect(res.skipped).toBe(5);
    expect(res.cars).toHaveLength(0);
  });

  it("машини зіставляються за назвою без урахування регістру", () => {
    const current = { ...emptyData(), cars: [{ id: "mine", name: "ТЕСТ" }] };
    const res = mergeBackup(current, backup, nextId);
    expect(res.cars).toHaveLength(0);
    expect(res.service.every((r) => r.car === "mine")).toBe(true);
  });

  it("дублікат: однакові тип, дата, машина, пробіг і сума в копійках", () => {
    const twice = { ...backup, service: [service[0], { ...service[0], id: "copy" }] };
    const res = mergeBackup(emptyData(), twice, nextId);
    expect(res.service).toHaveLength(1);
  });

  it("невідома категорія зберігається як є", () => {
    const custom = { ...backup, service: [{ ...service[0], cat: "Своя категория" }] };
    expect(mergeBackup(emptyData(), custom, nextId).service[0].cat).toBe("Своя категория");
  });

  it("бекап старої версії (без позицій і нагадувань) теж приймається", () => {
    const legacy = {
      cars: [{ id: "c", name: "Старая" }],
      service: [{ id: "s", car: "c", date: "2026-01-01", odo: null, cat: "Ремонт", what: "Что-то", where: "", sum: 100, note: "" }],
      fuel: [{ id: "f", car: "c", date: "2026-01-02", odo: 1000, liters: 10, sum: 500, station: "", full: true, note: "" }],
    };
    const res = mergeBackup(emptyData(), legacy, nextId);
    expect(res.added).toBe(2);
    expect(res.service[0].items).toEqual([]);
  });

  it("позиції та нагадування переносяться, а зв'язок із записом зберігається", () => {
    const withExtras = {
      ...backup,
      service: [{ ...service[0], items: [{ id: "i", kind: "parts" as const, name: "Масло", sum: 100 }] }],
      reminders: [
        { id: "r", car: CAR, title: "Масло", dueOdo: 340000, dueDate: null, done: false, doneDate: null, notified: 2 as const, recordId: "s1" },
      ],
    };
    const res = mergeBackup(emptyData(), withExtras, nextId);
    expect(res.service[0].items[0].name).toBe("Масло");
    expect(res.reminders[0].recordId).toBe(res.service[0].id);
    expect(res.reminders[0].notified).toBe(0);
  });

  it("занадто довгий текст зі старого бекапу обрізається, а запис не губиться", () => {
    const long = { ...backup, service: [{ ...service[0], what: "ы".repeat(5000), note: "н".repeat(5000) }], fuel: [] };
    const res = mergeBackup(emptyData(), long, nextId);
    expect(res.added).toBe(1);
    expect(res.service[0].what).toHaveLength(1000);
    expect(res.service[0].note).toHaveLength(1000);
  });

  it("зіпсовані рядки пропускаються, а не ламають імпорт", () => {
    const broken = { ...backup, service: [{ car: CAR, date: "вчора", sum: "abc" }], fuel: [{ car: "нема", liters: -1 }] };
    const res = mergeBackup(emptyData(), broken, nextId);
    expect(res.added).toBe(0);
    expect(res.skipped).toBe(2);
  });
});
