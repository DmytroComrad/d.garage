import { isIsoDate, parseOdo } from "./parse";
import { prefs, unitFactor, type Unit } from "./prefs";
import type { Wish } from "./types";

/*
 * Фільтр і сортування списків: журнали обслуговування й заправок, хотілки.
 * Дати — ISO, межі включно. Пробіг — у кілометрах, як у базі.
 */

export type RecordFilter = {
  from: string | null;
  to: string | null;
  odoFrom: number | null;
  odoTo: number | null;
};

export const NO_FILTER: RecordFilter = { from: null, to: null, odoFrom: null, odoTo: null };

export const isFiltered = (f: RecordFilter): boolean =>
  f.from != null || f.to != null || f.odoFrom != null || f.odoTo != null;

/** Те, що людина вписала у фільтр: дати з полів дати, пробіг — текстом у вибраних одиницях. */
export type FilterInputs = { from: string; to: string; odoFrom: string; odoTo: string };

export const EMPTY_INPUTS: FilterInputs = { from: "", to: "", odoFrom: "", odoTo: "" };

/**
 * Порожнє чи нерозібране поле фільтр не звужує.
 * Межі пробігу — в цілих кілометрах бази, так, щоб пройшли саме ті записи,
 * чий пробіг на екрані (округлений до миль) потрапляє у вписані межі.
 */
export function filterFromInputs(inputs: FilterInputs, unit: Unit = prefs().unit): RecordFilter {
  const factor = unitFactor(unit);
  const odo = (raw: string, edge: -0.5 | 0.5): number | null => {
    const value = parseOdo(raw);
    if (typeof value !== "number") return null;
    if (factor === 1) return value;
    const bound = Math.ceil((value + edge) * factor);
    return edge < 0 ? Math.max(0, bound) : bound - 1;
  };
  return {
    from: isIsoDate(inputs.from) ? inputs.from : null,
    to: isIsoDate(inputs.to) ? inputs.to : null,
    odoFrom: odo(inputs.odoFrom, -0.5),
    odoTo: odo(inputs.odoTo, 0.5),
  };
}

type Rec = { date: string; odo: number | null; sum: number };

/** Межі можна задати навпаки: «з 2026-12-01 по 2026-01-01» — те саме, що й навпаки. */
export function filterRecords<T extends Rec>(list: T[], f: RecordFilter): T[] {
  const [from, to] = f.from && f.to && f.from > f.to ? [f.to, f.from] : [f.from, f.to];
  const [odoFrom, odoTo] =
    f.odoFrom != null && f.odoTo != null && f.odoFrom > f.odoTo ? [f.odoTo, f.odoFrom] : [f.odoFrom, f.odoTo];
  const byOdo = odoFrom != null || odoTo != null;
  return list.filter((r) => {
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (!byOdo) return true;
    // Запис без пробігу до відрізка пробігу не належить.
    if (r.odo == null) return false;
    return (odoFrom == null || r.odo >= odoFrom) && (odoTo == null || r.odo <= odoTo);
  });
}

export const RECORD_SORTS = ["new", "old", "expensive", "cheap", "odoHigh", "odoLow"] as const;
export type RecordSort = (typeof RECORD_SORTS)[number];

/** Лише за датою список ділиться на місяці: при іншому порядку місяці перемішались би. */
export const sortsByDate = (sort: RecordSort): boolean => sort === "new" || sort === "old";

const newestFirst = (a: Rec, b: Rec): number => b.date.localeCompare(a.date) || (b.odo ?? -1) - (a.odo ?? -1);

/** Записи без пробігу при сортуванні за пробігом — в кінці, в будь-якому напрямку. */
const byOdo = (dir: 1 | -1) => (a: Rec, b: Rec): number => {
  if (a.odo == null || b.odo == null) return a.odo == null ? (b.odo == null ? 0 : 1) : -1;
  return (a.odo - b.odo) * dir;
};

/**
 * Однакові суми чи пробіги лишаються в порядку «нові зверху»: сортування стабільне.
 * `sumOf` — сума для порівняння: записи в різних валютах порівнюються в основній.
 */
export function sortRecords<T extends Rec>(list: T[], sort: RecordSort, sumOf: (r: T) => number = (r) => r.sum): T[] {
  const newest = [...list].sort(newestFirst);
  switch (sort) {
    case "new":
      return newest;
    case "old":
      return newest.reverse();
    case "expensive":
      return newest.sort((a, b) => sumOf(b) - sumOf(a));
    case "cheap":
      return newest.sort((a, b) => sumOf(a) - sumOf(b));
    case "odoHigh":
      return newest.sort(byOdo(-1));
    case "odoLow":
      return newest.sort(byOdo(1));
  }
}

export const PERIODS = ["month", "prevMonth", "days30", "days90", "year", "prevYear"] as const;
export type Period = (typeof PERIODS)[number];

const DAY_MS = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, days: number): string => iso(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);

/** Останній день місяця «2026-02» → «2026-02-28». */
export const monthEnd = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return iso(Date.UTC(y, m, 0));
};

/** Межі готового періоду відносно сьогодні. */
export function periodRange(period: Period, today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  switch (period) {
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "prevMonth": {
      const start = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
      return { from: `${start}-01`, to: monthEnd(start) };
    }
    case "days30":
      return { from: addDays(today, -29), to: today };
    case "days90":
      return { from: addDays(today, -89), to: today };
    case "year":
      return { from: `${year}-01-01`, to: today };
    case "prevYear":
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  }
}

/** Місяці, за які є записи, від нових до старих: «2026-11», «2026-10»… */
export const recordMonths = (list: { date: string }[]): string[] =>
  [...new Set(list.map((r) => r.date.slice(0, 7)))].sort().reverse();

export const WISH_SORTS = ["added", "newest", "expensive", "cheap", "title"] as const;
export type WishSort = (typeof WISH_SORTS)[number];

/**
 * Хотілки: невиконані завжди над виконаними, сортування — всередині кожної групи.
 * «added» — звичний порядок: невиконані в порядку додавання, виконані свіжі зверху.
 * За ціною діапазон рахується за верхньою межею, хотілки без ціни — в кінці.
 * `top` — верхня межа ціни для порівняння: хотілки в різних валютах порівнюються в основній.
 */
export function sortWishes<T extends Pick<Wish, "done" | "added" | "title" | "price"> & { priceMax?: number | null }>(
  wishes: T[],
  sort: WishSort,
  collator: Intl.Collator = new Intl.Collator(),
  top: (w: T) => number | null = (w) => w.priceMax ?? w.price,
): T[] {
  if (sort === "added") return wishes;
  const byPrice = (dir: 1 | -1) => (a: T, b: T): number => {
    const pa = top(a);
    const pb = top(b);
    if (pa == null || pb == null) return pa == null ? (pb == null ? 0 : 1) : -1;
    return (pa - pb) * dir;
  };
  const compare: Record<Exclude<WishSort, "added">, (a: T, b: T) => number> = {
    newest: (a, b) => b.added.localeCompare(a.added),
    expensive: byPrice(-1),
    cheap: byPrice(1),
    title: (a, b) => collator.compare(a.title, b.title),
  };
  return [...wishes].sort((a, b) => Number(a.done) - Number(b.done) || compare[sort](a, b));
}
