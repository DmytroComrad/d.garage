import { isCurrency, type Currency } from "./currency";

/**
 * Налаштування відображення: мова, одиниці відстані, формат дати й валюти.
 * У базі пробіг завжди в кілометрах, тож перемикач нічого не перераховує в даних, лише показ і введення.
 * Валюти теж лише для показу: кожен запис зберігає суму у своїй валюті.
 */
export type Lang = "en" | "uk" | "ru";
export type Unit = "km" | "mi";
export type DateFormat = "dmy" | "mdy" | "ymd";
/** Основна валюта, у якій рахуються всі підсумки, і додаткова, яку видно біля головних сум. */
export type CurrencyPrefs = { main: Currency; second: Currency | null };
/**
 * dual — показувати поруч і іншу одиницю: «12 000 км (7 456 mi)».
 * currency — валюти, які людина вибрала сама; null — ідуть за мовою.
 * currencyHintOff — від підказки про другу валюту відмовились; забувається, коли змінюється мова.
 */
export type Prefs = {
  lang: Lang;
  unit: Unit;
  dateFormat: DateFormat;
  dual: boolean;
  currency: CurrencyPrefs | null;
  currencyHintOff: boolean;
};

export const LANGS: readonly Lang[] = ["en", "uk", "ru"];
export const UNITS: readonly Unit[] = ["km", "mi"];
export const DATE_FORMATS: readonly DateFormat[] = ["dmy", "mdy", "ymd"];
export const DEFAULT_PREFS: Prefs = {
  lang: "en",
  unit: "km",
  dateFormat: "dmy",
  dual: false,
  currency: null,
  currencyHintOff: false,
};

/** Валюти за мовою, поки людина не вибрала свої: англійська — долар, українська й російська — гривня з доларом поруч. */
export const LANG_CURRENCIES: Record<Lang, CurrencyPrefs> = {
  en: { main: "USD", second: null },
  uk: { main: "UAH", second: "USD" },
  ru: { main: "UAH", second: "USD" },
};

export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);
const isUnit = (v: unknown): v is Unit => UNITS.includes(v as Unit);
const isDateFormat = (v: unknown): v is DateFormat => DATE_FORMATS.includes(v as DateFormat);

/** Додаткова валюта не може збігатися з основною. */
const readCurrencyPrefs = (raw: unknown): CurrencyPrefs | null => {
  if (!raw || typeof raw !== "object") return null;
  const { main, second } = raw as Record<string, unknown>;
  if (!isCurrency(main)) return null;
  return { main, second: isCurrency(second) && second !== main ? second : null };
};

/** Будь-що з localStorage → чинні налаштування. */
export const readPrefs = (raw: Partial<Record<keyof Prefs, unknown>> | null | undefined): Prefs => ({
  lang: isLang(raw?.lang) ? raw.lang : DEFAULT_PREFS.lang,
  unit: isUnit(raw?.unit) ? raw.unit : DEFAULT_PREFS.unit,
  dateFormat: isDateFormat(raw?.dateFormat) ? raw.dateFormat : DEFAULT_PREFS.dateFormat,
  dual: raw?.dual === true,
  currency: readCurrencyPrefs(raw?.currency),
  currencyHintOff: raw?.currencyHintOff === true,
});

/** Чинні валюти: вибрані людиною або ті, що за замовчуванням для мови. */
export const currencyPrefs = (p: Prefs): CurrencyPrefs => p.currency ?? LANG_CURRENCIES[p.lang];

/** Зміна налаштувань. Інша мова знову дозволяє підказку про другу валюту: відмова діяла лише для попередньої. */
export const nextPrefs = (prev: Prefs, patch: Partial<Prefs>): Prefs => {
  const next = { ...prev, ...patch };
  if (patch.lang && patch.lang !== prev.lang && patch.currencyHintOff === undefined) next.currencyHintOff = false;
  return next;
};

/** Людина вибрала основну валюту. Якщо нею стала додаткова, вони міняються місцями. */
export const pickMain = (p: Prefs, main: Currency): Prefs => {
  const cur = currencyPrefs(p);
  const second = cur.second === main ? (cur.main === main ? null : cur.main) : cur.second;
  return { ...p, currency: { main, second } };
};

/** Людина вибрала додаткову валюту або відмовилась від неї (null). */
export const pickSecond = (p: Prefs, second: Currency | null): Prefs => {
  const cur = currencyPrefs(p);
  return { ...p, currency: { main: cur.main, second: second === cur.main ? null : second } };
};

/** Підказку про другу валюту бачить англомовна людина, яка ще не вибирала валют і не відмовилась від підказки. */
export const showCurrencyHint = (p: Prefs): boolean => p.lang === "en" && p.currency === null && !p.currencyHintOff;

export const otherUnit = (unit: Unit): Unit => (unit === "km" ? "mi" : "km");

/**
 * Мова з заголовка Accept-Language: перша з наших за вагою q. Для сторінок, які відкривають без застосунку,
 * тож вибраної на сайті мови там немає. Нічого не підійшло — англійська.
 */
export function langFromAcceptLanguage(header: string | null | undefined): Lang {
  const ranked = (header ?? "")
    .split(",")
    .map((part, order) => {
      const [tag = "", ...params] = part.split(";").map((p) => p.trim());
      const q = params.find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.toLowerCase().split("-")[0], weight: Number.isFinite(weight) ? weight : 0, order };
    })
    .filter((entry) => entry.weight > 0 && isLang(entry.lang))
    .sort((a, b) => b.weight - a.weight || a.order - b.order);
  const best = ranked[0]?.lang;
  return isLang(best) ? best : DEFAULT_PREFS.lang;
}

let current: Prefs = DEFAULT_PREFS;

/**
 * Поточні налаштування інтерфейсу. Їх ставить лише браузер: сервер обслуговує різних людей одночасно,
 * тому мову він бере з кожного запиту окремо й передає явно.
 */
export const prefs = (): Prefs => current;
export const applyPrefs = (next: Prefs): void => {
  current = next;
};

/** Основна валюта з поточних налаштувань: у ній форматуються всі підсумки. */
export const mainCurrency = (p: Prefs = current): Currency => currencyPrefs(p).main;

export const KM_PER_MILE = 1.609344;

/** Скільки кілометрів в одиниці відстані: для величин «на одиницю шляху» (ціна, витрата). */
export const unitFactor = (unit: Unit = current.unit): number => (unit === "mi" ? KM_PER_MILE : 1);

/** Відстань у вибраних одиницях → кілометри для бази. Миля довша за кілометр, тож округлення не губить точності. */
export const toKm = (value: number, unit: Unit = current.unit): number =>
  unit === "mi" ? Math.round(value * KM_PER_MILE) : value;

/** Кілометри з бази → вибрані одиниці. */
export const fromKm = (km: number, unit: Unit = current.unit): number => (unit === "mi" ? Math.round(km / KM_PER_MILE) : km);
