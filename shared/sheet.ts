import { carSummary, fuelCalcs, fuelSummary } from "./calc";
import { CATEGORIES, ITEM_KINDS, categoryLabel, itemKindLabel } from "./constants";
import { MESSAGES } from "./i18n";
import { FUEL_GRADES, type FuelGrade } from "./fuelGrades";
import { parseDecimal } from "./parse";
import { LANGS, type Lang } from "./prefs";
import type { RawBackup } from "./backup";
import type { GarageData, ItemKind } from "./types";

/**
 * Таблиця-бекап. Усі значення рахує той самий код, що й сайт, і пишуться вони
 * числами, а не текстом і не формулами. Тому сума в таблиці не може розійтися
 * з сумою на сайті, а локаль таблиці (кома чи крапка) ні на що не впливає.
 * Назви листів і стовпців — мовою інтерфейсу, а читаються таблиці будь-якою з мов.
 * Відстані завжди в кілометрах: таблиця — це ще й бекап, одиниці в ньому не мають залежати від налаштувань.
 */
export type Cell = string | number | null | { date: string };
export type ColumnFormat = "text" | "money" | "int" | "dec1" | "liters" | "date";
export type Column = { title: string; format: ColumnFormat };
export type Sheet = { title: string; columns: Column[]; rows: Cell[][] };

type SheetKey = keyof (typeof MESSAGES)["en"]["sheet"]["tabs"];
type ColKey = keyof (typeof MESSAGES)["en"]["sheet"]["col"];

const SHEET_KEYS: SheetKey[] = ["summary", "service", "items", "fuel", "reminders", "wishes"];

const round = (n: number | null, digits: number): number | null =>
  n == null ? null : Math.round(n * 10 ** digits) / 10 ** digits;
const dateCell = (iso: string | null): Cell => (iso ? { date: iso } : null);

/** Назви листів-бекапу мовою `lang`. */
export const sheetTitles = (lang: Lang): string[] => SHEET_KEYS.map((k) => MESSAGES[lang].sheet.tabs[k]);

/** Назви листів-бекапу всіма мовами: по них сервер шукає і прибирає старі листи. */
export const ALL_SHEET_TITLES: ReadonlySet<string> = new Set(LANGS.flatMap(sheetTitles));

export function buildSheets(
  data: Pick<GarageData, "cars" | "service" | "fuel" | "reminders" | "wishes">,
  today: string,
  lang: Lang,
): Sheet[] {
  const m = MESSAGES[lang];
  const c = m.sheet.col;
  const col = (key: ColKey, format: ColumnFormat = "text"): Column => ({ title: c[key], format });
  const yesNo = (v: boolean) => (v ? m.sheet.yes : m.sheet.no);
  const carName = new Map(data.cars.map((car) => [car.id, car.name]));
  const byDate = <T extends { date: string }>(list: T[]) => [...list].sort((a, b) => a.date.localeCompare(b.date));

  const summary: Sheet = {
    title: m.sheet.tabs.summary,
    columns: [
      col("car"),
      col("total", "money"),
      col("service", "money"),
      col("fuel", "money"),
      col("thisYear", "money"),
      col("currentOdo", "int"),
      col("startOdo", "int"),
      col("driven", "int"),
      col("perKm", "money"),
      col("avgUse", "dec1"),
      col("lastUse", "dec1"),
      col("fills", "int"),
      col("poured", "liters"),
      col("avgPrice", "money"),
      col("fuelPerKm", "money"),
      col("since", "date"),
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
    title: m.sheet.tabs.service,
    columns: [
      col("car"),
      col("date", "date"),
      col("odo", "int"),
      col("category"),
      col("what"),
      col("where"),
      col("sum", "money"),
      col("note"),
      col("id"),
    ],
    rows: byDate(data.service).map((r) => [
      carName.get(r.car) ?? "",
      { date: r.date },
      r.odo,
      categoryLabel(r.cat, m),
      r.what,
      r.where,
      r.sum,
      r.note,
      r.id,
    ]),
  };

  const items: Sheet = {
    title: m.sheet.tabs.items,
    columns: [col("car"), col("date", "date"), col("record"), col("kind"), col("name"), col("sum", "money"), col("recordId")],
    rows: byDate(data.service).flatMap((r) =>
      r.items.map((it): Cell[] => [
        carName.get(r.car) ?? "",
        { date: r.date },
        r.what,
        itemKindLabel(it.kind, m),
        it.name,
        it.sum,
        r.id,
      ]),
    ),
  };

  const fuelRows = data.cars.flatMap((car) => {
    const list = data.fuel.filter((r) => r.car === car.id);
    const calcs = fuelCalcs(list);
    return list.map((r) => ({ r, calc: calcs.get(r.id), name: car.name }));
  });
  const fuel: Sheet = {
    title: m.sheet.tabs.fuel,
    columns: [
      col("car"),
      col("date", "date"),
      col("odo", "int"),
      col("liters", "liters"),
      col("sum", "money"),
      col("price", "money"),
      col("sinceLast", "int"),
      col("use", "dec1"),
      col("full"),
      col("station"),
      col("grade"),
      col("note"),
      col("id"),
    ],
    rows: fuelRows
      .sort((a, b) => a.r.date.localeCompare(b.r.date) || a.r.odo - b.r.odo)
      .map(({ r, calc, name }) => [
        name,
        { date: r.date },
        r.odo,
        r.liters,
        r.sum,
        round(calc?.price ?? null, 2),
        calc?.sinceLast ?? null,
        round(calc?.consumption ?? null, 2),
        yesNo(r.full),
        r.station,
        r.grade ? m.fuelGrades[r.grade] : "",
        r.note,
        r.id,
      ]),
  };

  const reminders: Sheet = {
    title: m.sheet.tabs.reminders,
    columns: [
      col("car"),
      col("task"),
      col("dueOdo", "int"),
      col("dueDate", "date"),
      col("done"),
      col("doneDate", "date"),
      col("recordId"),
    ],
    rows: data.reminders.map((r) => [
      carName.get(r.car) ?? "",
      r.title,
      r.dueOdo,
      dateCell(r.dueDate),
      yesNo(r.done),
      dateCell(r.doneDate),
      r.recordId ?? "",
    ]),
  };

  const wishes: Sheet = {
    title: m.sheet.tabs.wishes,
    columns: [
      col("car"),
      col("wish"),
      col("wishPrice", "money"),
      col("wishPriceMax", "money"),
      col("links"),
      col("note"),
      col("added", "date"),
      col("done"),
      col("doneDate", "date"),
      col("recordId"),
    ],
    rows: [...data.wishes]
      .sort((a, b) => a.added.localeCompare(b.added))
      .map((w) => [
        carName.get(w.car) ?? "",
        w.title,
        w.price,
        w.priceMax,
        w.links.join("\n"),
        w.note,
        { date: w.added },
        yesNo(w.done),
        dateCell(w.doneDate),
        w.recordId ?? "",
      ]),
  };

  return [summary, service, items, fuel, reminders, wishes];
}

/** Марка пального з таблиці: назва будь-якою мовою інтерфейсу або сам код. */
const gradeFromLabel = (label: string): FuelGrade | null => {
  const key = label.trim().toLocaleLowerCase("uk-UA");
  if (!key) return null;
  return (
    FUEL_GRADES.find(
      (g) => g.toLowerCase() === key || LANGS.some((l) => MESSAGES[l].fuelGrades[g].toLocaleLowerCase("uk-UA") === key),
    ) ?? null
  );
};

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

/** Шаблон дати для таблиць за форматом із налаштувань. */
export const SHEET_DATE_PATTERNS = { dmy: "dd.mm.yyyy", mdy: "mm/dd/yyyy", ymd: "yyyy-mm-dd" } as const;

const readDate = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return serialToDate(v);
  if (typeof v !== "string") return null;
  const value = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dmy = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const mdy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return mdy ? `${mdy[3]}-${mdy[1]}-${mdy[2]}` : null;
};

const readNum = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string" || v.trim() === "") return null;
  const parsed = parseDecimal(v);
  return typeof parsed === "number" ? parsed : null;
};

const readStr = (v: unknown): string => (v == null ? "" : String(v).trim());

const lower = (v: unknown): string => readStr(v).toLocaleLowerCase("ru-RU");
const YES = new Set(LANGS.map((l) => MESSAGES[l].sheet.yes));
const NO = new Set(LANGS.map((l) => MESSAGES[l].sheet.no));

/** Тип позиції за підписом будь-якою мовою. */
const kindByLabel = (label: string): ItemKind =>
  ITEM_KINDS.find((kind) => LANGS.some((l) => MESSAGES[l].itemKinds[kind].label === label)) ?? "extra";

/** Категорію з таблиці повертаємо до того рядка, що зберігається в записах. */
const categoryByLabel = (label: string): string =>
  CATEGORIES.find((c) => c.id === label || LANGS.some((l) => MESSAGES[l].categories[c.key] === label))?.id ?? label;

type Row = Record<string, unknown>;

/** Значення стовпця за назвою будь-якою мовою: користувач міг переставити стовпці чи змінити мову. */
const cell = (row: Row, key: ColKey): unknown => {
  for (const lang of LANGS) {
    const value = row[MESSAGES[lang].sheet.col[key]];
    if (value !== undefined) return value;
  }
  return undefined;
};

/** Лист → об'єкти за назвами стовпців. */
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

/** Який лист за що відповідає: обираємо мову, якою названо найбільше листів, а решту добираємо з інших. */
export function resolveSheetTabs(available: Iterable<string>): Partial<Record<SheetKey, string>> {
  const present = new Set(available);
  const ranked = [...LANGS].sort(
    (a, b) => sheetTitles(b).filter((t) => present.has(t)).length - sheetTitles(a).filter((t) => present.has(t)).length,
  );
  const out: Partial<Record<SheetKey, string>> = {};
  for (const key of SHEET_KEYS) {
    const title = ranked.map((l) => MESSAGES[l].sheet.tabs[key]).find((t) => present.has(t));
    if (title) out[key] = title;
  }
  return out;
}

/** Назад з таблиці у формат бекапу. Далі дані йдуть через те саме злиття, що й файл. */
export function sheetsToBackup(tabs: Record<string, unknown[][] | undefined>): RawBackup | null {
  const named = resolveSheetTabs(Object.keys(tabs).filter((k) => tabs[k] !== undefined));
  const sheet = (key: SheetKey) => (named[key] ? tabs[named[key]] : undefined);
  if (!sheet("summary") && !sheet("service") && !sheet("fuel")) return null;

  const names = new Set<string>();
  const carOf = (r: Row): string => {
    const car = readStr(cell(r, "car"));
    if (car) names.add(car);
    return car;
  };
  for (const r of toRows(sheet("summary"))) carOf(r);

  const itemsByRecord = new Map<string, Row[]>();
  for (const r of toRows(sheet("items"))) {
    const id = readStr(cell(r, "recordId"));
    if (id) itemsByRecord.set(id, [...(itemsByRecord.get(id) ?? []), r]);
  }

  const service = toRows(sheet("service")).flatMap((r) => {
    const car = carOf(r);
    if (!car) return [];
    const id = readStr(cell(r, "id"));
    return [
      {
        id,
        car,
        date: readDate(cell(r, "date")),
        odo: readNum(cell(r, "odo")),
        cat: categoryByLabel(readStr(cell(r, "category"))),
        what: readStr(cell(r, "what")),
        where: readStr(cell(r, "where")),
        sum: readNum(cell(r, "sum")),
        note: readStr(cell(r, "note")),
        items: (itemsByRecord.get(id) ?? []).map((it) => ({
          kind: kindByLabel(readStr(cell(it, "kind"))),
          name: readStr(cell(it, "name")),
          sum: readNum(cell(it, "sum")),
        })),
      },
    ];
  });

  const fuel = toRows(sheet("fuel")).flatMap((r) => {
    const car = carOf(r);
    if (!car) return [];
    return [
      {
        id: readStr(cell(r, "id")),
        car,
        date: readDate(cell(r, "date")),
        odo: readNum(cell(r, "odo")),
        liters: readNum(cell(r, "liters")),
        sum: readNum(cell(r, "sum")),
        station: readStr(cell(r, "station")),
        full: !NO.has(lower(cell(r, "full"))),
        grade: gradeFromLabel(readStr(cell(r, "grade"))),
        note: readStr(cell(r, "note")),
      },
    ];
  });

  const reminders = toRows(sheet("reminders")).flatMap((r) => {
    const car = carOf(r);
    if (!car) return [];
    return [
      {
        car,
        title: readStr(cell(r, "task")),
        dueOdo: readNum(cell(r, "dueOdo")),
        dueDate: readDate(cell(r, "dueDate")),
        done: YES.has(lower(cell(r, "done"))),
        doneDate: readDate(cell(r, "doneDate")),
        recordId: readStr(cell(r, "recordId")),
      },
    ];
  });

  const wishes = toRows(sheet("wishes")).flatMap((r) => {
    const car = carOf(r);
    if (!car) return [];
    return [
      {
        car,
        title: readStr(cell(r, "wish")),
        price: readNum(cell(r, "wishPrice")),
        priceMax: readNum(cell(r, "wishPriceMax")),
        links: readStr(cell(r, "links")).split(/\s+/).filter(Boolean),
        note: readStr(cell(r, "note")),
        added: readDate(cell(r, "added")),
        done: YES.has(lower(cell(r, "done"))),
        doneDate: readDate(cell(r, "doneDate")),
        recordId: readStr(cell(r, "recordId")),
      },
    ];
  });

  return {
    cars: [...names].map((name) => ({ id: name, name })),
    service,
    fuel,
    reminders,
    wishes,
  };
}
