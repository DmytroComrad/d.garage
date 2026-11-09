import { LOCALES, messages } from "./i18n";
import { fromKm, otherUnit, prefs, unitFactor, type DateFormat, type Lang } from "./prefs";

/*
 * Форматування для інтерфейсу: мова, одиниці й формат дати беруться з поточних налаштувань.
 * Вхідні відстані завжди в кілометрах, як у базі.
 */

const NBSP = " ";

const formatters = new Map<string, Intl.NumberFormat>();
const numberFormat = (min: number, max: number, lang: Lang = prefs().lang): Intl.NumberFormat => {
  const key = `${lang}|${min}|${max}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALES[lang], { minimumFractionDigits: min, maximumFractionDigits: max });
    formatters.set(key, f);
  }
  return f;
};

const ok = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

export const fmtMoney0 = (n: number | null | undefined): string =>
  ok(n) ? `${numberFormat(0, 0).format(n)}${NBSP}₴` : "—";

/** «14 000 ₴» або діапазон «4 000–6 000 ₴». */
export const fmtMoneyRange = (min: number, max: number | null | undefined): string =>
  ok(max) && max > min ? `${numberFormat(0, 0).format(min)}–${fmtMoney0(max)}` : fmtMoney0(min);

export const fmtMoney = (n: number | null | undefined): string =>
  ok(n) ? `${numberFormat(2, 2).format(n)}${NBSP}₴` : "—";

export const fmtNum = (n: number): string => numberFormat(0, 0).format(n);

/** Розмір файлу: «840 КБ», «2,4 МБ». */
export const fmtFileSize = (bytes: number): string => {
  const u = messages().manuals.size;
  if (bytes < 1024) return `${fmtNum(bytes)}${NBSP}${u.b}`;
  if (bytes < 1024 * 1024) return `${fmtNum(Math.round(bytes / 1024))}${NBSP}${u.kb}`;
  return `${numberFormat(1, 1).format(bytes / 1024 / 1024)}${NBSP}${u.mb}`;
};

/** Коротка назва сайту для посилання: «rozetka.com.ua» замість довгої адреси. */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Ціле число з одиницею відстані: «12 000 км», «5,000 mi», «3 милі». Число вже в потрібних одиницях. */
export const fmtUnits = (n: number, unit = prefs().unit): string => `${fmtNum(n)}${NBSP}${messages().units.dist[unit](n)}`;

/**
 * Відстань із бази (км) у вибраних одиницях. Якщо в профілі ввімкнено обидві одиниці,
 * друга йде в дужках: «12 000 км (7 456 mi)» — для машин, привезених зі США, і їхніх старих документів.
 */
export const fmtDist = (km: number | null | undefined): string => {
  if (!ok(km)) return "—";
  const { unit, dual } = prefs();
  const main = fmtUnits(fromKm(km, unit), unit);
  if (!dual) return main;
  const other = otherUnit(unit);
  return `${main} (${fmtUnits(fromKm(km, other), other)})`;
};

/** Позначка одиниці для підписів полів: «км», «mi», «мили». */
export const unitLabel = (): string => messages().units.label[prefs().unit];

export const fmtDec1 = (n: number | null | undefined): string => (ok(n) ? numberFormat(1, 1).format(n) : "—");

export const fmtLiters = (n: number | null | undefined): string =>
  ok(n) ? `${numberFormat(2, 2).format(n)}${NBSP}${messages().units.liter}` : "—";

export const fmtLiters1 = (n: number): string => `${numberFormat(1, 1).format(n)}${NBSP}${messages().units.liter}`;

/** Об'єм двигуна: «1,6 л», «1,25 л». */
export const fmtEngine = (liters: number): string =>
  `${numberFormat(1, 2).format(liters)}${NBSP}${messages().units.liter}`;

/** Витрата в базі — л/100 км. У милях — л/100 миль. */
export const consumptionValue = (per100km: number): number => per100km * unitFactor();

export const fmtConsumptionValue = (n: number | null | undefined): string => (ok(n) ? fmtDec1(consumptionValue(n)) : "—");

export const fmtConsumption = (n: number | null | undefined): string =>
  ok(n) ? `${fmtDec1(consumptionValue(n))}${NBSP}${messages().units.per100[prefs().unit]}` : "—";

/** Вартість кілометра → вартість вибраної одиниці відстані. */
export const fmtPerDist = (perKm: number | null | undefined): string => (ok(perKm) ? fmtMoney(perKm * unitFactor()) : "—");

/** Число для поля введення: кома в українській і російській, крапка в англійській. */
export const numInput = (n: number): string => (prefs().lang === "en" ? String(n) : String(n).replace(".", ","));

export const formatDate = (iso: string, format: DateFormat): string => {
  const [y, m, d] = iso.split("-");
  if (format === "mdy") return `${m}/${d}/${y}`;
  if (format === "ymd") return `${y}-${m}-${d}`;
  return `${d}.${m}.${y}`;
};

export const fmtDate = (iso: string | null | undefined): string => (iso ? formatDate(iso, prefs().dateFormat) : "—");

/** Дата й час із секунд Unix: 24-годинний формат, крім американського порядку дати. */
export const fmtDateTime = (seconds: number): string => {
  const date = new Date(seconds * 1000);
  const iso = todayISO(date);
  const { dateFormat, lang } = prefs();
  const time = date.toLocaleTimeString(LOCALES[lang], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: dateFormat === "mdy",
  });
  return `${formatDate(iso, dateFormat)} ${time}`;
};

/** "2026-08" → "серпень 2026" */
export const fmtMonthKey = (key: string): string => {
  const [y, m] = key.split("-").map(Number);
  return `${messages().months[m - 1]} ${y}`;
};

export const monthShort = (index: number): string => messages().monthsShort[index];

export const todayISO = (now: Date = new Date()): string => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const genId = (): string => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const random = new Uint8Array(5);
  crypto.getRandomValues(random);
  let suffix = "";
  for (const b of random) suffix += alphabet[b % alphabet.length];
  return Date.now().toString(36) + suffix;
};

export const nameKey = (name: string): string => name.trim().toLocaleLowerCase("ru-RU");
