/*
 * Валюти записів і курси НБУ.
 * Курс — скільки гривень коштує одиниця валюти на дату запису. Курси минулих дат не змінюються,
 * тож перерахована сума запису фіксується сама собою: вона не «стрибає», коли курс рухається.
 */

export const CURRENCIES = ["UAH", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];
/** Гривня — база курсів НБУ, її курс завжди 1. Решту беремо з НБУ. */
export type ForeignCurrency = Exclude<Currency, "UAH">;
export const FOREIGN_CURRENCIES: readonly ForeignCurrency[] = ["USD", "EUR"];
/** Валюта записів, які з'явились до валют, і записів від старих клієнтів. */
export const DEFAULT_CURRENCY: Currency = "UAH";

export const CURRENCY_SYMBOLS: Record<Currency, string> = { UAH: "₴", USD: "$", EUR: "€" };

export const isCurrency = (v: unknown): v is Currency => CURRENCIES.includes(v as Currency);

/** Валюта з таблиці чи бекапу: код або знак. Невідоме — гривня, як у записах до появи валют. */
export const readCurrency = (v: unknown): Currency => {
  const value = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (isCurrency(value)) return value;
  return CURRENCIES.find((c) => CURRENCY_SYMBOLS[c] === value) ?? DEFAULT_CURRENCY;
};

/** Курси за датами: «2026-11-09» → { USD: 41.2, EUR: 47.9 }. Дати без відомого курсу просто немає. */
export type FxRates = Record<string, Partial<Record<ForeignCurrency, number>>>;

/** Дати з курсом кожної валюти, від старих до нових. Рахується раз на об'єкт курсів. */
const indexes = new WeakMap<FxRates, Map<ForeignCurrency, string[]>>();

const datesWith = (rates: FxRates, code: ForeignCurrency): string[] => {
  let index = indexes.get(rates);
  if (!index) {
    index = new Map();
    indexes.set(rates, index);
  }
  let dates = index.get(code);
  if (!dates) {
    dates = Object.keys(rates)
      .filter((d) => {
        const rate = rates[d]?.[code];
        return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
      })
      .sort();
    index.set(code, dates);
  }
  return dates;
};

/**
 * Курс валюти на дату: гривень за одиницю. Якщо на саму дату курсу ще немає (вихідний, сьогодні до публікації,
 * НБУ недоступний), береться найближча попередня відома дата, а якщо такої немає — найближча наступна.
 * null — курсу цієї валюти немає взагалі.
 */
export function rateOn(code: Currency, date: string, rates: FxRates): number | null {
  if (code === "UAH") return 1;
  const exact = rates[date]?.[code];
  if (typeof exact === "number" && Number.isFinite(exact) && exact > 0) return exact;
  const dates = datesWith(rates, code);
  if (!dates.length) return null;
  // Перша дата, пізніша за потрібну: перед нею — найближча попередня.
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= date) lo = mid + 1;
    else hi = mid;
  }
  const nearest = lo > 0 ? dates[lo - 1] : dates[0];
  return rates[nearest][code] ?? null;
}

/** Скільки одиниць валюти `to` дає одиниця валюти `from` на дату. null — курсу немає. */
export function fxFactor(from: Currency, to: Currency, date: string, rates: FxRates): number | null {
  if (from === to) return 1;
  const a = rateOn(from, date, rates);
  const b = rateOn(to, date, rates);
  return a == null || b == null ? null : a / b;
}

/** Гроші до копійки: так суми не накопичують похибку плаваючої коми. */
export const roundMoney = (v: number): number => Math.round(v * 100) / 100;

/** Сума з валюти запису у валюту `to` за курсом на дату запису. null — курсу немає. */
export function convert(amount: number, from: Currency, to: Currency, date: string, rates: FxRates): number | null {
  const factor = fxFactor(from, to, date, rates);
  return factor == null ? null : from === to ? amount : roundMoney(amount * factor);
}

/** Усе, що має суму у своїй валюті на свою дату. */
export type Priced = { sum: number; currency: Currency; date: string };

/** Те, що не вдалося перерахувати: курсу цієї валюти немає взагалі. Суми по валютах, як є. */
export type Rest = Partial<Record<Currency, number>>;

/** Підсумок в одній валюті плюс те, що перерахувати не вдалося. */
export type Total = { sum: number; rest: Rest };

const addCents = (acc: number, v: number): number => acc + Math.round(v * 100);

/** Сума записів у валюті `to`: кожен перераховується за курсом на свою дату. */
export function totalIn(records: readonly Priced[], to: Currency, rates: FxRates): Total {
  let cents = 0;
  const restCents: Partial<Record<Currency, number>> = {};
  for (const r of records) {
    const value = convert(r.sum, r.currency, to, r.date, rates);
    if (value != null) cents = addCents(cents, value);
    else restCents[r.currency] = addCents(restCents[r.currency] ?? 0, r.sum);
  }
  const rest: Rest = {};
  for (const code of CURRENCIES) {
    const v = restCents[code];
    if (v) rest[code] = v / 100;
  }
  return { sum: cents / 100, rest };
}

/** Запис із сумою у валюті `to`. Без курсу сума стає 0: її видно окремо в `rest` підсумків. */
export function recordIn<T extends Priced & { items?: { sum: number }[] }>(record: T, to: Currency, rates: FxRates): T {
  if (record.currency === to) return record;
  const factor = fxFactor(record.currency, to, record.date, rates);
  const value = (v: number) => (factor == null ? 0 : roundMoney(v * factor));
  return {
    ...record,
    currency: to,
    sum: value(record.sum),
    ...(record.items ? { items: record.items.map((it) => ({ ...it, sum: value(it.sum) })) } : {}),
  };
}

export type PricedWish = { price: number | null; priceMax: number | null; currency: Currency; added: string };

/** Ціна хотілки у валюті `to` за курсом на день, коли її додали. null — курсу немає. */
export function wishIn<T extends PricedWish>(wish: T, to: Currency, rates: FxRates): T | null {
  if (wish.currency === to) return wish;
  const factor = fxFactor(wish.currency, to, wish.added, rates);
  if (factor == null) return null;
  const value = (v: number | null) => (v == null ? null : roundMoney(v * factor));
  return { ...wish, currency: to, price: value(wish.price), priceMax: value(wish.priceMax) };
}

export const isRestEmpty = (rest: Rest): boolean => !CURRENCIES.some((c) => rest[c]);
