import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { mergeBackup } from "../../shared/backup";
import { carSummary, fuelCalcs } from "../../shared/calc";
import { applyOp, emptyData, retargetOp } from "../../shared/ops";
import { buildReminder, notifiedLevel, reminderDraft, sortReminders } from "../../shared/reminders";
import { opSchema } from "../../shared/schema";
import { buildSheets, type Sheet } from "../../shared/sheet";
import type { FuelRecord, Op, Photo, Reminder } from "../../shared/types";
import { carView } from "../../src/lib/view";
import { buildXlsx } from "../../src/lib/xlsx";
import { CAR, fuel, service } from "./fixtures";

const rem = (over: Partial<Reminder> = {}): Reminder => ({
  id: "r1",
  car: "c1",
  title: "Масло",
  dueOdo: 100000,
  dueDate: null,
  done: false,
  doneDate: null,
  notified: 0,
  recordId: null,
  ...over,
});

describe("швидкий розрахунок витрати збігається з означенням зі специфікації", () => {
  /** Означення п. 2.1 дослівно: повільно, зате очевидно правильно. */
  const naive = (list: FuelRecord[]) =>
    new Map(
      list.map((rec) => {
        const earlier = list.filter((f) => f.odo < rec.odo);
        const prev = earlier.length ? Math.max(...earlier.map((f) => f.odo)) : null;
        const fulls = earlier.filter((f) => f.full);
        let consumption: number | null = null;
        if (rec.full && fulls.length) {
          const prevFull = Math.max(...fulls.map((f) => f.odo));
          const liters =
            list.filter((f) => f.odo > prevFull && f.odo <= rec.odo).reduce((a, f) => a + Math.round(f.liters * 1000), 0) /
            1000;
          consumption = (liters / (rec.odo - prevFull)) * 100;
        }
        return [rec.id, { sinceLast: prev == null ? null : rec.odo - prev, consumption }];
      }),
    );

  // Псевдовипадкові послідовності з повторами пробігу й неповними баками, щоб тест був відтворюваним.
  const generate = (seed: number, size: number): FuelRecord[] => {
    let x = seed;
    const next = (max: number) => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x % max;
    };
    return Array.from({ length: size }, (_, i) => ({
      id: `f${i}`,
      car: CAR,
      date: `2026-0${1 + next(9)}-1${next(9)}`,
      odo: 1000 + next(Math.max(2, size)) * 50,
      liters: 10 + next(4000) / 100,
      sum: 500 + next(300000) / 100,
      station: "",
      full: next(4) !== 0,
      note: "",
    }));
  };

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("послідовність %i", (seed) => {
    const list = generate(seed, 5 + seed * 7);
    const fast = fuelCalcs(list);
    const slow = naive(list);
    expect(fast.size).toBe(slow.size);
    for (const [id, expected] of slow) {
      const actual = fast.get(id);
      expect(actual?.sinceLast).toBe(expected.sinceLast);
      if (expected.consumption == null) expect(actual?.consumption).toBeNull();
      else expect(actual?.consumption).toBeCloseTo(expected.consumption, 9);
    }
  });

  it("3000 заправок рахуються швидко", () => {
    const list = generate(9, 3000);
    const started = performance.now();
    fuelCalcs(list);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("зведення", () => {
  it("у цьому році рахуються лише записи з 1 січня", () => {
    const old = { ...service[0], id: "old", date: "2025-12-31", sum: 999 };
    expect(carSummary([old, service[0]], [], "2026-09-15").thisYear).toBe(service[0].sum);
  });

  it("останнє обслуговування: найпізніша дата, при рівній — більший пробіг", () => {
    const later = { ...service[0], id: "later", date: "2026-08-17", odo: 327999 };
    expect(carSummary([service[0], later], [], "2026-09-15").lastService?.id).toBe("later");
  });
});

describe("порядок нагадувань", () => {
  it("терміновіші зверху, за рівного рівня менше кілометрів", () => {
    const rows = sortReminders(
      [
        rem({ id: "far", dueOdo: 120000 }),
        rem({ id: "soon", dueOdo: 100400 }),
        rem({ id: "sooner", dueOdo: 100200 }),
        rem({ id: "late", dueOdo: 99000 }),
      ],
      100000,
      "2026-09-15",
    );
    expect(rows.map((r) => r.reminder.id)).toEqual(["late", "sooner", "soon", "far"]);
  });
});

describe("напоминание в формі", () => {
  const opts = {
    car: "c1",
    recordId: "rec",
    baseOdo: 100000,
    fallbackTitle: "Замена",
    today: "2026-09-15",
    makeId: () => "new-id",
  };
  const draft = (over = {}) => ({ on: true, title: "Масло", km: "10000", date: "", ...over });

  it("без галочки нічого не створює", () => {
    expect(buildReminder(draft({ on: false }), opts)).toEqual({ reminder: null });
  });

  it("рахує пробіг від запису", () => {
    const built = buildReminder(draft(), opts);
    expect("reminder" in built && built.reminder?.dueOdo).toBe(110000);
  });

  it("помилки: сміття, нічого не вказано, кілометри без пробігу", () => {
    expect(buildReminder(draft({ km: "abc" }), opts)).toEqual({ error: "В напоминании километры — только цифры." });
    expect("error" in buildReminder(draft({ km: "" }), opts)).toBe(true);
    expect("error" in buildReminder(draft(), { ...opts, baseOdo: null })).toBe(true);
  });

  it("назва за замовчуванням, а нове нагадування не вискакує відразу", () => {
    const built = buildReminder(draft({ title: "", km: "400" }), opts);
    if (!("reminder" in built) || !built.reminder) throw new Error("no reminder");
    expect(built.reminder.title).toBe("Замена");
    expect(built.reminder.notified).toBe(2);
  });

  it("при редагуванні зберігає id, а незмінений строк не скидає показаний рівень", () => {
    const linked = rem({ id: "kept", dueOdo: 110000, notified: 1 });
    const built = buildReminder(draft(), { ...opts, linked });
    if (!("reminder" in built) || !built.reminder) throw new Error("no reminder");
    expect(built.reminder.id).toBe("kept");
    expect(built.reminder.notified).toBe(1);
  });

  it("чернетка з наявного нагадування показує залишок кілометрів", () => {
    expect(reminderDraft(rem({ dueOdo: 110000 }), 100000)).toMatchObject({ on: true, km: "10000" });
  });

  it("зміна строку перераховує показаний рівень", () => {
    const previous = rem({ dueOdo: 110000, notified: 3 });
    expect(notifiedLevel({ dueOdo: 120000, dueDate: null }, previous, 100000, "2026-09-15")).toBe(0);
  });
});

describe("імпорт і межі сервера", () => {
  const raw = {
    cars: [{ id: "c", name: "Машина" }],
    service: [
      { id: "ok", car: "c", date: "2026-01-01", odo: 100, cat: "Ремонт", what: "Что-то", sum: 10 },
      { id: "bad-date", car: "c", date: "2026-13-45", odo: 100, cat: "Ремонт", what: "Что-то", sum: 20 },
      { id: "bad-feb", car: "c", date: "2026-02-31", odo: 100, cat: "Ремонт", what: "Что-то", sum: 30 },
      { id: "neg-odo", car: "c", date: "2026-01-02", odo: -5, cat: "Ремонт", what: "Что-то", sum: 40 },
      { id: "huge", car: "c", date: "2026-01-03", odo: 100, cat: "Ремонт", what: "Что-то", sum: 1e12 },
    ],
    fuel: [
      { id: "fok", car: "c", date: "2026-01-04", odo: 200, liters: 30, sum: 100 },
      { id: "flit", car: "c", date: "2026-01-05", odo: 300, liters: 200000, sum: 100 },
      { id: "fzero", car: "c", date: "2026-01-06", odo: 400, liters: 30, sum: 0 },
    ],
    reminders: [
      { car: "c", title: "Плохое", dueOdo: -1 },
      { car: "c", title: "Хорошее", dueOdo: 5000, recordId: "ok" },
    ],
  };

  it("те, що сервер відхилить, не рахується доданим", () => {
    const res = mergeBackup(emptyData(), raw, () => crypto.randomUUID());
    expect(res.service.map((r) => r.what)).toHaveLength(1);
    expect(res.fuel).toHaveLength(1);
    expect(res.reminders).toHaveLength(1);
    expect(res.added).toBe(3);
    expect(res.skipped).toBe(7);
  });

  it("усе додане проходить схему сервера", () => {
    const res = mergeBackup(emptyData(), raw, () => crypto.randomUUID());
    const ops: Op[] = [
      ...res.cars.map((data): Op => ({ type: "car.put", data })),
      ...res.service.map((data): Op => ({ type: "service.put", data })),
      ...res.fuel.map((data): Op => ({ type: "fuel.put", data })),
      ...res.reminders.map((data): Op => ({ type: "reminder.put", data })),
    ];
    expect(ops.length).toBe(4);
    for (const op of ops) expect(opSchema.safeParse(op).success, JSON.stringify(op)).toBe(true);
  });
});

describe("зміни в пам'яті", () => {
  const photo = (over: Partial<Photo> = {}): Photo => ({
    id: "p",
    car: "c1",
    kind: "record",
    recordId: "s1",
    name: "x",
    mime: "image/jpeg",
    size: 1,
    width: null,
    height: null,
    createdAt: 0,
    driveId: "d",
    ...over,
  });

  it("запис переїхав на іншу машину: фото й нагадування їдуть із ним", () => {
    const data = {
      ...emptyData(),
      service: [{ ...service[0], id: "s1", car: "c1" }],
      photos: [photo()],
      reminders: [rem({ recordId: "s1" })],
    };
    const next = applyOp(data, { type: "service.put", data: { ...service[0], id: "s1", car: "c2" } });
    expect(next.photos[0].car).toBe("c2");
    expect(next.reminders[0].car).toBe("c2");
  });

  it("без переїзду посилання на масиви не змінюються", () => {
    const data = { ...emptyData(), photos: [photo()], reminders: [rem()] };
    const next = applyOp(data, { type: "service.put", data: { ...service[0], id: "other", car: "c1" } });
    expect(next.photos).toBe(data.photos);
    expect(next.reminders).toBe(data.reminders);
  });

  it("перепризначення машини чіпає лише її записи", () => {
    const aliases = new Map([["dup", "real"]]);
    const op: Op = { type: "fuel.put", data: { ...fuel[0], car: "dup" } };
    const other: Op = { type: "fuel.put", data: { ...fuel[0], car: "keep" } };
    const moved = retargetOp(op, aliases);
    expect(moved.type === "fuel.put" && moved.data.car).toBe("real");
    expect(retargetOp(other, aliases)).toBe(other);
  });
});

describe("подання машини", () => {
  const data = { ...emptyData(), service, fuel };

  it("те саме подання, доки дані не змінились", () => {
    expect(carView(data, CAR, "2026-09-15")).toBe(carView(data, CAR, "2026-09-15"));
    expect(carView(data, CAR, "2026-09-15")).not.toBe(carView(data, CAR, "2026-09-16"));
    expect(carView({ ...data }, CAR, "2026-09-15")).not.toBe(carView(data, CAR, "2026-09-15"));
  });

  it("чужа машина в подання не потрапляє", () => {
    const view = carView(data, "інша", "2026-09-15");
    expect(view.service).toEqual([]);
    expect(view.summary.hasRecords).toBe(false);
  });
});

describe("файл .xlsx", () => {
  const sheet: Sheet = {
    title: "Лист",
    columns: [
      { title: "Текст", format: "text" },
      { title: "Сумма", format: "money" },
      { title: "Дата", format: "date" },
    ],
    rows: [
      ['A & B <c> "d"', 1234.56, { date: "2026-08-17" }],
      ["управляющий\u0001символ", null, null],
    ],
  };

  it("екранує спецсимволи й пише числа числами", async () => {
    const book = new ExcelJS.Workbook();
    const bytes = buildXlsx([sheet]);
    await book.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    const ws = book.getWorksheet("Лист");
    expect(ws?.getCell("A2").value).toBe('A & B <c> "d"');
    expect(ws?.getCell("B2").value).toBe(1234.56);
    expect(ws?.getCell("A3").value).toBe("управляющийсимвол");
  });

  it("повна таблиця гаража відкривається без помилок", async () => {
    const data = { ...emptyData(), cars: [{ id: CAR, name: "Тест" }], service, fuel };
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(buildXlsx(buildSheets(data, "2026-09-15"))) as unknown as ArrayBuffer);
    expect(book.worksheets).toHaveLength(5);
  });
});
