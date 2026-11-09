import { FOREIGN_CURRENCIES, type ForeignCurrency, type FxRates } from "../shared/currency";
import { isIsoDate } from "../shared/parse";
import type { GarageData } from "../shared/types";
import type { Bindings } from "./types";

/*
 * Офіційні курси НБУ. Один запит повертає всі валюти на дату, тож запитуємо лише дати, яких ще немає в базі,
 * і зберігаємо їх назавжди: курс минулої дати не змінюється. НБУ отримує тільки дату:
 * жодних даних людей, cookie чи заголовків із їхніх запитів.
 */

export const NBU_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange";

/** Гривня з'явилась 2 вересня 1996 року: раніших курсів у гривнях немає. */
const FIRST_DATE = "1996-09-02";

/** Скільки нових дат /api/state дотягує сам. Решту добирає cron, щоб відповідь не чекала на НБУ. */
export const FILL_PER_REQUEST = 6;
/** Скільки дат cron бере за раз, коли зовнішні запити не зайняті переносом фото. */
export const BACKFILL_PER_RUN = 20;
const PARALLEL = 3;
/** Довше на НБУ в запиті людини не чекаємо: сайт має відкриватись і без курсів. */
const REQUEST_DEADLINE_MS = 2500;
const CRON_DEADLINE_MS = 15_000;

/** Дату запитали, а курсів НБУ на неї не має (далеке минуле): позначка, щоб не питати знову. */
const MARK = "UAH";

type DayRates = Partial<Record<ForeignCurrency, number>>;

const kyivDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Сьогодні за київським часом: курси НБУ встановлюються на київські дати, а Worker живе в UTC. */
export const nbuToday = (now: Date = new Date()): string => {
  const part = (type: string) => kyivDate.formatToParts(now).find((p) => p.type === type)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return isIsoDate(date) ? date : now.toISOString().slice(0, 10);
};
type RateRow = { date: string; code: string; rate: number };

const isForeign = (code: unknown): code is ForeignCurrency => FOREIGN_CURRENCIES.includes(code as ForeignCurrency);

const addRate = (rates: FxRates, r: RateRow): void => {
  if (isForeign(r.code)) (rates[r.date] ??= {})[r.code] = r.rate;
};

/** Відповідь НБУ: [{ cc: "USD", rate: 41.2, … }, …]. Беремо лише наші валюти й лише справжні числа. */
const parseDay = (items: unknown[]): DayRates => {
  const out: DayRates = {};
  for (const item of items) {
    const { cc, rate } = (item ?? {}) as { cc?: unknown; rate?: unknown };
    if (isForeign(cc) && typeof rate === "number" && Number.isFinite(rate) && rate > 0 && rate < 1_000_000) out[cc] = rate;
  }
  return out;
};

/**
 * Сталі курси замість НБУ для e2e й тестів Worker, щоб тести не ходили в інтернет.
 * Змінна є лише в wrangler.e2e.jsonc і wrangler.test.jsonc і діє тільки на localhost: у продакшені вона нічого не робить.
 */
function testRates(env: Bindings): DayRates | null {
  if (!env.FX_TEST_RATES || new URL(env.APP_URL).hostname !== "localhost") return null;
  try {
    const raw = JSON.parse(env.FX_TEST_RATES) as Record<string, unknown>;
    return parseDay(Object.entries(raw).map(([cc, rate]) => ({ cc, rate })));
  } catch {
    return null;
  }
}

/** Курси на одну дату. null — НБУ не відповів як слід. */
async function fetchDay(env: Bindings, date: string, signal: AbortSignal): Promise<DayRates | null> {
  const fixed = testRates(env);
  if (fixed) return fixed;
  const res = await fetch(`${NBU_URL}?date=${date.replaceAll("-", "")}&json`, { signal });
  if (!res.ok) return null;
  const body: unknown = await res.json().catch(() => null);
  return Array.isArray(body) ? parseDay(body) : null;
}

/**
 * Кілька дат паралельно, не більше PARALLEL одночасно і не довше за `deadline`.
 * Після першої невдачі нових запитів не починаємо: НБУ, мабуть, недоступний.
 */
async function fetchDays(env: Bindings, dates: string[], deadline: number): Promise<Map<string, DayRates>> {
  const out = new Map<string, DayRates>();
  const signal = AbortSignal.timeout(deadline);
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (!failed && next < dates.length) {
      const date = dates[next++];
      const day = await fetchDay(env, date, signal).catch(() => null);
      if (day) out.set(date, day);
      else failed = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, dates.length) }, lane));
  return out;
}

/**
 * Запис отриманих курсів. Порожня відповідь за минулу дату остаточна (лишаємо позначку), а за сьогодні — ні:
 * курс могли ще не опублікувати, спитаємо пізніше. Збережені дати виходять із черги cron.
 */
function saveStatements(
  db: D1Database,
  fetched: Map<string, DayRates>,
  today: string,
): { statements: D1PreparedStatement[]; saved: string[] } {
  const insert = db.prepare("INSERT OR REPLACE INTO fx_rates (date, code, rate) VALUES (?, ?, ?)");
  const statements: D1PreparedStatement[] = [];
  const saved: string[] = [];
  for (const [date, day] of fetched) {
    const codes = FOREIGN_CURRENCIES.filter((c) => day[c] != null);
    if (!codes.length && date >= today) continue;
    for (const code of codes) statements.push(insert.bind(date, code, day[code] as number));
    if (!codes.length) statements.push(insert.bind(date, MARK, 1));
    saved.push(date);
  }
  if (saved.length) {
    statements.push(db.prepare("DELETE FROM fx_queue WHERE date IN (SELECT value FROM json_each(?))").bind(JSON.stringify(saved)));
  }
  return { statements, saved };
}

/** Дати, на які людині потрібні курси: дати записів, дні додавання хотілок і сьогодні. Від нових до старих. */
export function neededDates(data: Pick<GarageData, "service" | "fuel" | "wishes">, today: string): string[] {
  const dates = new Set<string>([today]);
  for (const r of data.service) dates.add(r.date);
  for (const r of data.fuel) dates.add(r.date);
  for (const w of data.wishes) dates.add(w.added);
  return [...dates].filter((d) => isIsoDate(d) && d >= FIRST_DATE && d <= today).sort().reverse();
}

export type StateRates = {
  rates: FxRates;
  /** Чи є всі потрібні курси. Якщо ні, клієнт не отримає 304 і наступного разу забере дотягнуті. */
  complete: boolean;
};

/**
 * Курси для відповіді людині — лише на її дати, тож чужі дати записів через курси не видно.
 * Яких дат ще немає, кілька найсвіжіших дотягуємо одразу (сьогодні першим), решту ставимо в чергу cron.
 * `fill: false` — лише те, що вже є в базі, без звернень до НБУ.
 */
export async function ratesFor(
  env: Bindings,
  data: Pick<GarageData, "service" | "fuel" | "wishes">,
  today: string,
  { fill = true } = {},
): Promise<StateRates> {
  const db = env.DB;
  const dates = neededDates(data, today);
  const rates: FxRates = {};
  const seen = new Set<string>();
  const { results } = await db
    .prepare("SELECT f.date, f.code, f.rate FROM json_each(?) j JOIN fx_rates f ON f.date = j.value")
    .bind(JSON.stringify(dates))
    .all<RateRow>();
  for (const r of results) {
    seen.add(r.date);
    addRate(rates, r);
  }

  let missing = dates.filter((d) => !seen.has(d));
  if (missing.length && fill) {
    const fetched = await fetchDays(env, missing.slice(0, FILL_PER_REQUEST), REQUEST_DEADLINE_MS);
    const { statements, saved } = saveStatements(db, fetched, today);
    for (const [date, day] of fetched) {
      for (const code of FOREIGN_CURRENCIES) if (day[code] != null) addRate(rates, { date, code, rate: day[code] as number });
    }
    const done = new Set(saved);
    missing = missing.filter((d) => !done.has(d));
    if (missing.length) {
      statements.push(
        db.prepare("INSERT OR IGNORE INTO fx_queue (date) SELECT value FROM json_each(?)").bind(JSON.stringify(missing)),
      );
    }
    // Курси — лише кеш: якщо база зараз не записала, люди все одно отримують свої дані.
    if (statements.length) {
      await db.batch(statements).catch((err: unknown) => {
        console.warn(JSON.stringify({ event: "fx_save_failed", message: String(err) }));
      });
    }
  }

  // Сьогоднішнього курсу ще немає: даємо найсвіжіший відомий, щоб нові записи було від чого рахувати.
  if (!rates[today]) {
    const { results: last } = await db
      .prepare(
        `SELECT date, code, rate FROM fx_rates
         WHERE date = (SELECT MAX(date) FROM fx_rates WHERE date <= ?1 AND code <> 'UAH') AND code <> 'UAH'`,
      )
      .bind(today)
      .all<RateRow>();
    for (const r of last) addRate(rates, r);
  }
  return { rates, complete: missing.length === 0 };
}

/**
 * Скільки дат cron може дотягнути, щоб разом із переносом фото не вийти за 50 зовнішніх запитів
 * на виклик безкоштовного плану: на кожне фото — до трьох запитів до Google і ще, можливо, оновлення токена.
 */
export const backfillBudget = (photos: number): number => Math.max(0, Math.min(BACKFILL_PER_RUN, 48 - 4 * photos));

/** Cron: спершу сьогоднішній курс, щоб перші люди дня вже мали його, потім черга від нових дат до старих. */
export async function backfillRates(env: Bindings, limit = BACKFILL_PER_RUN): Promise<number> {
  if (limit <= 0) return 0;
  const db = env.DB;
  const today = nbuToday();
  const [own, queued] = await db.batch<{ date: string }>([
    db.prepare("SELECT date FROM fx_rates WHERE date = ? LIMIT 1").bind(today),
    db.prepare("SELECT date FROM fx_queue ORDER BY date DESC LIMIT ?").bind(limit),
  ]);
  const dates = [...(own.results.length ? [] : [today]), ...queued.results.map((r) => r.date).filter((d) => d !== today)].slice(
    0,
    limit,
  );
  if (!dates.length) return 0;
  const fetched = await fetchDays(env, dates, CRON_DEADLINE_MS);
  const { statements, saved } = saveStatements(db, fetched, today);
  if (statements.length) await db.batch(statements);
  return saved.length;
}
