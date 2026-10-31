import { describe, expect, it } from "vitest";
import { mergeBackup } from "../../shared/backup";
import { carSummary, fuelSummary, sumMoney } from "../../shared/calc";
import { emptyData } from "../../shared/ops";
import {
  SHEET_TITLES,
  buildSheets,
  dateToSerial,
  serialToDate,
  sheetValues,
  sheetsToBackup,
} from "../../shared/sheet";
import type { Sheet } from "../../shared/sheet";
import type { ServiceRecord } from "../../shared/types";
import { CAR, fuel, partial, service } from "./fixtures";

const today = "2026-09-15";
/** Контрольна сума: те, що показує сайт, дорівнює сумі рядків таблиці. */
const sheetColumnTotal = (sheet: Sheet, title: string): number => {
  const i = sheet.columns.findIndex((c) => c.title === title);
  return sumMoney(sheet.rows.map((r) => (typeof r[i] === "number" ? (r[i] as number) : 0)));
};
const allFuel = [...fuel, ...partial];
const withItems: ServiceRecord = {
  ...service[2],
  sum: 8620,
  items: [
    { id: "a", kind: "parts", name: "Фреон", sum: 5000 },
    { id: "b", kind: "labor", name: "Работа", sum: 3620 },
  ],
};
const allService = [service[0], service[1], withItems];
const data = {
  ...emptyData(),
  cars: [{ id: CAR, name: "Тест" }],
  service: allService,
  fuel: allFuel,
  reminders: [
    { id: "r", car: CAR, title: "Масло", dueOdo: 340000, dueDate: "2027-01-01", done: false, doneDate: null, notified: 0 as const, recordId: "s3" },
  ],
};
const sheets = buildSheets(data, today);
const byTitle = (title: string) => {
  const found = sheets.find((s) => s.title === title);
  if (!found) throw new Error(title);
  return found;
};
const cell = (title: string, column: string, row = 0) => {
  const sheet = byTitle(title);
  return sheet.rows[row][sheet.columns.findIndex((c) => c.title === column)];
};

describe("таблиця показує те саме, що й сайт", () => {
  const site = carSummary(allService, allFuel, today);
  const siteFuel = fuelSummary(allFuel);

  it("суми в зведенні дорівнюють зведенню на сайті", () => {
    expect(cell(SHEET_TITLES.summary, "Вложено всего, ₴")).toBe(site.total);
    expect(cell(SHEET_TITLES.summary, "Обслуживание, ₴")).toBe(site.serviceTotal);
    expect(cell(SHEET_TITLES.summary, "Топливо, ₴")).toBe(site.fuelTotal);
    expect(cell(SHEET_TITLES.summary, "Текущий пробег, км")).toBe(site.currentOdo);
  });

  it("сума рядків дорівнює підсумку: формули не можуть розійтися", () => {
    expect(sheetColumnTotal(byTitle(SHEET_TITLES.service), "Сумма, ₴")).toBe(site.serviceTotal);
    expect(sheetColumnTotal(byTitle(SHEET_TITLES.fuel), "Сумма, ₴")).toBe(site.fuelTotal);
    expect(sheetColumnTotal(byTitle(SHEET_TITLES.items), "Сумма, ₴")).toBe(withItems.sum);
  });

  it("витрата реальна, без 918 л/100 км, і це число, а не текст", () => {
    expect(cell(SHEET_TITLES.summary, "Средний расход, л/100")).toBe(Math.round((siteFuel.avg ?? 0) * 100) / 100);
    expect(cell(SHEET_TITLES.summary, "Средний расход, л/100")).toBeLessThan(20);
    const consumption = cell(SHEET_TITLES.fuel, "Расход, л/100", 1);
    expect(typeof consumption).toBe("number");
    expect(consumption).toBe(7.84);
  });

  it("суми й літри пишуться числами незалежно від локалі", () => {
    for (const row of byTitle(SHEET_TITLES.fuel).rows) {
      expect(typeof row[3]).toBe("number");
      expect(typeof row[4]).toBe("number");
    }
  });
});

describe("дати", () => {
  it("серійні номери Google Таблиць та Excel", () => {
    expect(dateToSerial("1970-01-01")).toBe(25569);
    expect(dateToSerial("2026-08-17")).toBe(46251);
    expect(serialToDate(46251)).toBe("2026-08-17");
  });
});

describe("відновлення з таблиці", () => {
  const tabs = Object.fromEntries(sheets.map((s) => [s.title, sheetValues(s)]));

  it("повний цикл: те, що записали, читається назад без втрат", () => {
    const backup = sheetsToBackup(tabs);
    expect(backup).not.toBeNull();
    let n = 0;
    const res = mergeBackup(emptyData(), backup!, () => `n${++n}`);
    expect(res.added).toBe(allService.length + allFuel.length + 1);
    expect(res.cars.map((c) => c.name)).toEqual(["Тест"]);

    const svc = res.service.find((r) => r.what === withItems.what);
    expect(svc?.sum).toBe(8620);
    expect(svc?.items.map((i) => [i.kind, i.name, i.sum])).toEqual([
      ["parts", "Фреон", 5000],
      ["labor", "Работа", 3620],
    ]);

    const partialRow = res.fuel.find((r) => r.odo === 328300);
    expect(partialRow?.full).toBe(false);
    expect(partialRow?.liters).toBe(20);
    expect(res.fuel.find((r) => r.odo === 327599)?.sum).toBe(2939.95);
    expect(res.reminders[0].dueDate).toBe("2027-01-01");
    expect(res.reminders[0].recordId).toBe(svc?.id);
  });

  it("повторне відновлення не створює дублікатів", () => {
    const res = mergeBackup(data, sheetsToBackup(tabs)!, () => "x");
    expect(res.added).toBe(0);
  });

  it("витримує текст у числових комірках, якщо таблицю правили вручну", () => {
    const edited = sheetValues(byTitle(SHEET_TITLES.fuel)).map((row, i) =>
      i === 1 ? row.map((v, j) => (j === 3 ? "37,74" : j === 1 ? "21.08.2026" : v)) : row,
    );
    const backup = sheetsToBackup({ [SHEET_TITLES.fuel]: edited })!;
    const res = mergeBackup(emptyData(), backup, () => crypto.randomUUID());
    expect(res.fuel.find((r) => r.odo === 327599)?.liters).toBe(37.74);
    expect(res.fuel.find((r) => r.odo === 327599)?.date).toBe("2026-08-21");
  });

  it("чужа таблиця не приймається", () => {
    expect(sheetsToBackup({ "Лист1": [["a"]] })).toBeNull();
  });
});
