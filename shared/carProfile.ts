import { LIMITS } from "./constants";
import { fmtEngine, numInput } from "./format";
import { messages, type Messages } from "./i18n";
import { isIsoDate, parseDecimal, parseMoney, type Parsed } from "./parse";
import type { Car, CarProfile } from "./types";

/*
 * Профіль машини: рік, VIN, номер, кузов, двигун, пальне й покупка. Усе необов'язкове.
 * Перевірки тут спільні для форми, сервера, бекапу й таблиці.
 */

/** Кузов і пальне зберігаються кодами, а не підписами: підпис обирає інтерфейс своєю мовою. */
export const BODY_TYPES = [
  "sedan",
  "hatchback",
  "liftback",
  "wagon",
  "coupe",
  "convertible",
  "suv",
  "minivan",
  "pickup",
  "van",
  "other",
] as const;
export type BodyType = (typeof BODY_TYPES)[number];

/** Коди пального стабільні: за ними згодом підказуватимемо марки пального на заправці. */
export const FUEL_TYPES = ["petrol", "diesel", "lpg_petrol", "lpg"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const isBodyType = (v: unknown): v is BodyType => (BODY_TYPES as readonly unknown[]).includes(v);
export const isFuelType = (v: unknown): v is FuelType => (FUEL_TYPES as readonly unknown[]).includes(v);

export const EMPTY_PROFILE: CarProfile = {
  year: null,
  vin: null,
  plate: null,
  body: null,
  engine: null,
  fuelType: null,
  purchaseDate: null,
  purchasePrice: null,
  about: null,
};

/** VIN часто пишуть із пробілами й малими літерами: зберігаємо без них. */
export const normalizeVin = (raw: string): string => raw.replace(/\s+/g, "").toUpperCase();

/** Латинські літери й цифри без I, O і Q. 17 знаків — стандарт із 1981 року, у старших машин номер коротший. */
export const isVin = (vin: string): boolean => /^[A-HJ-NPR-Z0-9]{5,17}$/.test(vin);

/** Номерний знак — як написали, лише великими літерами й без зайвих пробілів. */
export const normalizePlate = (raw: string): string => raw.trim().replace(/\s+/g, " ").toUpperCase();

/**
 * Найпізніша дата, яка вже настала хоч десь: годинники бувають і на UTC+14.
 * Так сервер не відкине «сьогодні» людини, в якої вже завтра.
 */
export const latestToday = (now: number = Date.now()): string =>
  new Date(now + 14 * 3_600_000).toISOString().slice(0, 10);

/** Машини наступного модельного року продають заздалегідь, тож і він годиться. */
export const maxCarYear = (today: string): number => Number(today.slice(0, 4)) + 1;

export const isCarYear = (year: number, today: string): boolean =>
  Number.isInteger(year) && year >= LIMITS.minCarYear && year <= maxCarYear(today);

export const isEngine = (liters: number): boolean =>
  Number.isFinite(liters) && liters >= LIMITS.minEngine && liters <= LIMITS.maxEngine;

/** Об'єм двигуна в літрах із двома знаками: 1,6 чи 1,25. */
export const roundEngine = (liters: number): number => Math.round(liters * 100) / 100;

/** Об'єм у літрах: «1.6», «1,6 л», «2.0L». Поза межами 0,1–20 л — помилка. */
export function parseEngine(raw: string): Parsed {
  const value = parseDecimal(raw.replace(/l\.?\s*$/i, ""));
  if (typeof value !== "number") return value;
  return isEngine(value) ? roundEngine(value) : "invalid";
}

export const isEmptyProfile = (profile: CarProfile | null | undefined): boolean =>
  !profile || Object.values(profile).every((v) => v == null);

export const hasProfile = (car: Car): boolean => !isEmptyProfile(car.profile);

/** Порожній профіль у машині не тримаємо: так стан із сервера й зі своєї черги однаковий. */
export function withProfile(car: Car, profile: CarProfile): Car {
  const { profile: _old, ...rest } = car;
  return isEmptyProfile(profile) ? rest : { ...rest, profile };
}

/** Поля форми — рядки, як їх набрано. */
export type ProfileDraft = Record<keyof CarProfile, string>;

export const profileDraft = (profile: CarProfile | undefined): ProfileDraft => {
  const p = profile ?? EMPTY_PROFILE;
  return {
    year: p.year == null ? "" : String(p.year),
    vin: p.vin ?? "",
    plate: p.plate ?? "",
    body: p.body ?? "",
    engine: p.engine == null ? "" : numInput(p.engine),
    fuelType: p.fuelType ?? "",
    purchaseDate: p.purchaseDate ?? "",
    purchasePrice: p.purchasePrice == null ? "" : numInput(p.purchasePrice),
    about: p.about ?? "",
  };
};

export type ProfileError = "errYear" | "errVin" | "errEngine" | "errDate" | "errPrice";
export type ParsedProfile = { ok: true; profile: CarProfile } | { ok: false; error: ProfileError };

/** Форма → профіль. Порожнє поле — «не вказано»; помилка — код, текст обирає інтерфейс. */
export function parseProfileForm(draft: ProfileDraft, today: string): ParsedProfile {
  const fail = (error: ProfileError): ParsedProfile => ({ ok: false, error });

  const yearText = draft.year.trim();
  const year = yearText ? Number(yearText) : null;
  if (year != null && (!/^\d{4}$/.test(yearText) || !isCarYear(year, today))) return fail("errYear");

  const vin = normalizeVin(draft.vin);
  if (vin && !isVin(vin)) return fail("errVin");

  const engine = parseEngine(draft.engine);
  if (engine === "invalid") return fail("errEngine");

  const purchaseDate = draft.purchaseDate.trim() || null;
  if (purchaseDate != null && (!isIsoDate(purchaseDate) || purchaseDate > today)) return fail("errDate");

  const price = parseMoney(draft.purchasePrice);
  if (price === "invalid" || (price != null && price > LIMITS.maxSum)) return fail("errPrice");

  return {
    ok: true,
    profile: {
      year,
      vin: vin || null,
      plate: normalizePlate(draft.plate).slice(0, LIMITS.plateLength).trim() || null,
      body: isBodyType(draft.body) ? draft.body : null,
      engine,
      fuelType: isFuelType(draft.fuelType) ? draft.fuelType : null,
      purchaseDate,
      purchasePrice: price == null ? null : Math.round(price * 100) / 100,
      about: draft.about.trim().slice(0, LIMITS.carAboutLength) || null,
    },
  };
}

/** Коротко під назвою машини: «2012 · Ліфтбек · 1,6 л · AA1234BB», лише заповнене. */
export function profileSummary(profile: CarProfile | undefined, m: Messages = messages()): string {
  if (!profile) return "";
  return [
    profile.year == null ? null : String(profile.year),
    // «Інший» кузов нічого не каже про машину.
    profile.body && profile.body !== "other" ? m.carProfile.bodies[profile.body] : null,
    profile.engine == null ? null : fmtEngine(profile.engine),
    profile.plate,
  ]
    .filter(Boolean)
    .join(" · ");
}
