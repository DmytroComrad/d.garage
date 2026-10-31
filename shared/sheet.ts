import { carSummary, fuelCalcs, fuelSummary } from "./calc";
import { itemKindLabel } from "./constants";
import { parseDecimal } from "./parse";
import type { RawBackup } from "./backup";
import type { GarageData, ItemKind } from "./types";

/**
 * Таблиця-бекап. Усі значення рахує той самий код, що й сайт, і пишуться вони
 * числами, а не текстом і не формулами. Тому сума в таблиці не може розійтися
 * з сумою на сайті, а локаль таблиці (кома чи крапка) ні на що не впливає.
 */
export type Cell = string | number | null | { date: string };
export type ColumnFormat = "text" | "money" | "int" | "dec1" | "liters" | "date";
export type Column = { title: string; format: ColumnFormat };
export type Sheet = { title: string; columns: Column[]; rows: Cell[][] };

const col = (title: string, format: ColumnFormat = "text"): Column => ({ title, format });
const round = (n: number | null, digits: number): number | null =>
  n == null ? null : Math.round(n * 10 ** digits) / 10 ** digits;
const dateCell = (iso: string | null): Cell => (iso ? { date: iso } : null);

export const SHEET_TITLES = {
  summary: "Сводка",
  service: "Обслуживание",
  items: "Позиции",
  fuel: "Заправки",
  reminders: "Напоминания",
} as const;

export function buildSheets(
  data: Pick<GarageData, "cars" | "service" | "fuel" | "reminders">,
  today: string,
): Sheet[] {
  const carName = new Map(data.cars.map((c) => [c.id, c.name]));
  const byDate = <T extends { date: string }>(list: T[]) => [...list].sort((a, b) => a.date.localeCompare(b.date));

  const summary: Sheet = {
    title: SHEET_TITLES.summary,
    columns: [
      col("Машина"),
      col("Вложено всего, ₴", "money"),
      col("Обслуживание, ₴", "money"),
      col("Топливо, ₴", "money"),
      col("В этом году, ₴", "money"),
      col("Текущий пробег, км", "int"),
      col("Пробег в начале учёта, км", "int"),
      col("Проехано, км", "int"),
      col("1 км обходится, ₴", "money"),
      col("Средний расход, л/100", "dec1"),
      col("Последний расход, л/100", "dec1"),
      col("Заправок", "int"),
      col("Залито, л", "liters"),
      col("Средняя цена литра, ₴", "money"),
      col("Топливо на 1 км, ₴", "money"),
      col("Учёт с", "date"),
    ],
    rows: data.cars.map((car) => {
      const service = data.service.filter((r) => r.car === car.id);
      const fuel = data.fuel.filter((r) => r.car === car.id);
      const s = carSummary(service, fuel, today);
      const f = fuelSummary(fuel);
      return [
        car.name,
        s.total,
        s.serviceTotal,
        s.fuelTotal,
        s.thisYear,
        s.currentOdo,
        s.startOdo,
        s.driven,
        round(s.perKm, 2),
        round(f.avg, 2),
        round(f.last, 2),
        f.count,
        f.liters,
        round(f.avgPrice, 2),
        round(f.perKm, 2),
        dateCell(s.since),
      ];
    }),
  };

  const service: Sheet = {
    title: SHEET_TITLES.service,
    columns: [
      col("Машина"),
      col("Дата", "date"),
      col("Пробег, км", "int"),
      col("Категория"),
      col("Что сделано / куплено"),
      col("Где"),
      col("Сумма, ₴", "money"),
      col("Заметка"),
      col("ID"),
    ],
    rows: byDate(data.service).map((r) => [
      carName.get(r.car) ?? "",
      { date: r.date },
      r.odo,
      r.cat,
      r.what,
      r.where,
      r.sum,
      r.note,
      r.id,
    ]),
  };

  const items: Sheet = {
    title: SHEET_TITLES.items,
    columns: [
      col("Машина"),
      col("Дата", "date"),
      col("Запись"),
      col("Тип"),
      col("Название"),
      col("Сумма, ₴", "money"),
      col("ID записи"),
    ],
    rows: byDate(data.service).flatMap((r) =>
      r.items.map((it): Cell[] => [
        carName.get(r.car) ?? "",
        { date: r.date },
        r.what,
        itemKindLabel(it.kind),
        it.name,
        it.sum,
        r.id,
      ]),
    ),
  };

  const fuelRows = data.cars.flatMap((car) => {
    const list = data.fuel.filter((r) => r.car === car.id);
    const calcs = fuelCalcs(list);
    return list.map((r) => ({ r, c: calcs.get(r.id), name: car.name }));
  });
  const fuel: Sheet = {
    title: SHEET_TITLES.fuel,
    columns: [
      col("Машина"),
      col("Дата", "date"),
      col("Пробег, км", "int"),
      col("Литры", "liters"),
      col("Сумма, ₴", "money"),
      col("Цена литра, ₴", "money"),
      col("Проехал, км", "int"),
      col("Расход, л/100", "dec1"),
      col("Полный бак"),
      col("АЗС"),
      col("Заметка"),
      col("ID"),
    ],
    rows: fuelRows
      .sort((a, b) => a.r.date.localeCompare(b.r.date) || a.r.odo - b.r.odo)
      .map(({ r, c, name }) => [
        name,
        { date: r.date },
        r.odo,
        r.liters,
        r.sum,
        round(c?.price ?? null, 2),
        c?.sinceLast ?? null,
        round(c?.consumption ?? null, 2),
        r.full ? "да" : "нет",
        r.station,
        r.note,
        r.id,
      ]),
  };

  const reminders: Sheet = {
    title: SHEET_TITLES.reminders,
    columns: [
      col("Машина"),
      col("Что сделать"),
      col("На пробеге, км", "int"),
      col("К дате", "date"),
      col("Выполнено"),
      col("Дата выполнения", "date"),
      col("ID записи"),
    ],
    rows: data.reminders.map((r) => [
      carName.get(r.car) ?? "",
      r.title,
      r.dueOdo,
      dateCell(r.dueDate),
      r.done ? "да" : "нет",
      dateCell(r.doneDate),
      r.recordId ?? "",
    ]),
  };

  return [summary, service, items, fuel, reminders];
}

/** Серійний номер дати, як його розуміють Google Таблиці й Excel (днів від 30.12.1899). */
export const dateToSerial = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 86_400_000 + 25_569;

export const serialToDate = (serial: number): string =>
  new Date(Math.round((serial - 25_569) * 86_400_000)).toISOString().slice(0, 10);

export const cellValue = (cell: Cell): string | number | null =>
  cell !== null && typeof cell === "object" ? dateToSerial(cell.date) : cell;

/** Рядки на листі: перший — заголовки. */
export const sheetValues = (sheet: Sheet): (string | number | null)[][] => [
  sheet.columns.map((c) => c.title),
  ...sheet.rows.map((row) => row.map(cellValue)),
];

const readDate = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return serialToDate(v);
  if (typeof v !== "string") return null;
  const value = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const readNum = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string" || v.trim() === "") return null;
  const parsed = parseDecimal(v);
  return typeof parsed === "number" ? parsed : null;
};

const readStr = (v: unknown): string => (v == null ? "" : String(v).trim());

const kindByLabel = (label: string): ItemKind =>
  label === itemKindLabel("parts") ? "parts" : label === itemKindLabel("labor") ? "labor" : "extra";

type Row = Record<string, unknown>;

/** Лист → об'єкти за назвами стовпців. Користувач міг переставити стовпці. */
const toRows = (values: unknown[][] | undefined): Row[] => {
  if (!values || values.length < 2) return [];
  const headers = values[0].map(readStr);
  return values.slice(1).map((row) => {
    const out: Row = {};
    headers.forEach((h, i) => {
      out[h] = row[i];
    });
    return out;
  });
};

/** Назад з таблиці у формат бекапу. Далі дані йдуть через те саме злиття, що й файл. */
export function sheetsToBackup(tabs: Record<string, unknown[][] | undefined>): RawBackup | null {
  if (!tabs[SHEET_TITLES.summary] && !tabs[SHEET_TITLES.service] && !tabs[SHEET_TITLES.fuel]) return null;

  const names = new Set<string>();
  for (const r of toRows(tabs[SHEET_TITLES.summary])) if (readStr(r["Машина"])) names.add(readStr(r["Машина"]));

  const itemsByRecord = new Map<string, Row[]>();
  for (const r of toRows(tabs[SHEET_TITLES.items])) {
    const id = readStr(r["ID записи"]);
    if (id) itemsByRecord.set(id, [...(itemsByRecord.get(id) ?? []), r]);
  }

  const service = toRows(tabs[SHEET_TITLES.service]).flatMap((r) => {
    const car = readStr(r["Машина"]);
    if (!car) return [];
    names.add(car);
    const id = readStr(r["ID"]);
    return [
      {
        id,
        car,
        date: readDate(r["Дата"]),
        odo: readNum(r["Пробег, км"]),
        cat: readStr(r["Категория"]),
        what: readStr(r["Что сделано / куплено"]),
        where: readStr(r["Где"]),
        sum: readNum(r["Сумма, ₴"]),
        note: readStr(r["Заметка"]),
        items: (itemsByRecord.get(id) ?? []).map((it) => ({
          kind: kindByLabel(readStr(it["Тип"])),
          name: readStr(it["Название"]),
          sum: readNum(it["Сумма, ₴"]),
        })),
      },
    ];
  });

  const fuel = toRows(tabs[SHEET_TITLES.fuel]).flatMap((r) => {
    const car = readStr(r["Машина"]);
    if (!car) return [];
    names.add(car);
    return [
      {
        id: readStr(r["ID"]),
        car,
        date: readDate(r["Дата"]),
        odo: readNum(r["Пробег, км"]),
        liters: readNum(r["Литры"]),
        sum: readNum(r["Сумма, ₴"]),
        station: readStr(r["АЗС"]),
        full: readStr(r["Полный бак"]).toLowerCase() !== "нет",
        note: readStr(r["Заметка"]),
      },
    ];
  });

  const reminders = toRows(tabs[SHEET_TITLES.reminders]).flatMap((r) => {
    const car = readStr(r["Машина"]);
    if (!car) return [];
    names.add(car);
    return [
      {
        car,
        title: readStr(r["Что сделать"]),
        dueOdo: readNum(r["На пробеге, км"]),
        dueDate: readDate(r["К дате"]),
        done: readStr(r["Выполнено"]).toLowerCase() === "да",
        doneDate: readDate(r["Дата выполнения"]),
        recordId: readStr(r["ID записи"]),
      },
    ];
  });

  return {
    cars: [...names].map((name) => ({ id: name, name })),
    service,
    fuel,
    reminders,
  };
}
