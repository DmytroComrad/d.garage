/**
 * Налаштування відображення: мова, одиниці відстані й формат дати.
 * У базі пробіг завжди в кілометрах, тож перемикач нічого не перераховує в даних, лише показ і введення.
 */
export type Lang = "en" | "uk" | "ru";
export type Unit = "km" | "mi";
export type DateFormat = "dmy" | "mdy" | "ymd";
export type Prefs = { lang: Lang; unit: Unit; dateFormat: DateFormat };

export const LANGS: readonly Lang[] = ["en", "uk", "ru"];
export const UNITS: readonly Unit[] = ["km", "mi"];
export const DATE_FORMATS: readonly DateFormat[] = ["dmy", "mdy", "ymd"];
export const DEFAULT_PREFS: Prefs = { lang: "en", unit: "km", dateFormat: "dmy" };

export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);
const isUnit = (v: unknown): v is Unit => UNITS.includes(v as Unit);
const isDateFormat = (v: unknown): v is DateFormat => DATE_FORMATS.includes(v as DateFormat);

/** Будь-що з localStorage → чинні налаштування. */
export const readPrefs = (raw: Partial<Record<keyof Prefs, unknown>> | null | undefined): Prefs => ({
  lang: isLang(raw?.lang) ? raw.lang : DEFAULT_PREFS.lang,
  unit: isUnit(raw?.unit) ? raw.unit : DEFAULT_PREFS.unit,
  dateFormat: isDateFormat(raw?.dateFormat) ? raw.dateFormat : DEFAULT_PREFS.dateFormat,
});

let current: Prefs = DEFAULT_PREFS;

/**
 * Поточні налаштування інтерфейсу. Їх ставить лише браузер: сервер обслуговує різних людей одночасно,
 * тому мову він бере з кожного запиту окремо й передає явно.
 */
export const prefs = (): Prefs => current;
export const applyPrefs = (next: Prefs): void => {
  current = next;
};

export const KM_PER_MILE = 1.609344;

/** Скільки кілометрів в одиниці відстані: для величин «на одиницю шляху» (ціна, витрата). */
export const unitFactor = (unit: Unit = current.unit): number => (unit === "mi" ? KM_PER_MILE : 1);

/** Відстань у вибраних одиницях → кілометри для бази. Миля довша за кілометр, тож округлення не губить точності. */
export const toKm = (value: number, unit: Unit = current.unit): number =>
  unit === "mi" ? Math.round(value * KM_PER_MILE) : value;

/** Кілометри з бази → вибрані одиниці. */
export const fromKm = (km: number, unit: Unit = current.unit): number => (unit === "mi" ? Math.round(km / KM_PER_MILE) : km);
