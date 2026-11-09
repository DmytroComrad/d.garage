import { LIMITS } from "./constants";

/** Результат розбору поля: число, порожньо або щось, що числом не є. */
export type Parsed = number | null | "invalid";

const stripUnits = (value: string): string =>
  value
    .replace(/[\s   ]/g, "")
    .replace(/₴/g, "")
    .replace(/грн\.?/gi, "")
    .replace(/км|km|mi|миль|мили|милі/gi, "")
    .replace(/л/gi, "");

/** Пробіг: крапки й коми — це лише роздільники тисяч. */
export function parseOdo(raw: string): Parsed {
  const value = stripUnits(raw).replace(/[.,]/g, "");
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return "invalid";
  const odo = Number(value);
  return odo > LIMITS.maxOdo ? "invalid" : odo;
}

/**
 * Дробове число за правилами специфікації:
 * - кома і крапка разом: десятковий той, що останній;
 * - один роздільник кілька разів: тисячі;
 * - для грошей один роздільник і рівно 3 цифри після нього: теж тисячі;
 * - інакше: десятковий.
 */
export function parseDecimal(raw: string, opts: { money?: boolean } = {}): Parsed {
  let value = stripUnits(raw);
  if (value === "") return null;

  const hasComma = value.includes(",");
  const hasDot = value.includes(".");

  if (hasComma && hasDot) {
    const decimal = value.lastIndexOf(",") > value.lastIndexOf(".") ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    value = value.split(thousands).join("").replace(decimal, ".");
  } else if (hasComma || hasDot) {
    const sep = hasComma ? "," : ".";
    const parts = value.split(sep);
    if (parts.length > 2) {
      value = parts.join("");
    } else if (opts.money && parts[1].length === 3 && parts[0] !== "") {
      value = parts.join("");
    } else {
      value = parts.join(".");
    }
  }

  if (!/^\d*\.?\d+$/.test(value)) return "invalid";
  return Number(value);
}

export const parseMoney = (raw: string): Parsed => parseDecimal(raw, { money: true });

/** Ціна хотілки: одне число або діапазон. Межі однакові — це одна ціна. */
export type PriceRange = { price: number | null; priceMax: number | null };

/**
 * «14000», «4000-6000», «4 000 – 6 000 ₴», «1.500…2.000». Межі можна написати в будь-якому порядку.
 * Мінуса тут не буває, тож дефіс завжди розділяє межі.
 */
export function parsePriceRange(raw: string): PriceRange | "invalid" {
  const parts = raw.split(/-|–|—|\.\.\.?|…/);
  if (parts.length > 2) return "invalid";
  if (parts.length === 1) {
    const price = parseMoney(raw);
    return price === "invalid" ? "invalid" : { price, priceMax: null };
  }
  const [a, b] = parts.map(parseMoney);
  if (typeof a !== "number" || typeof b !== "number") return "invalid";
  const [low, high] = a <= b ? [a, b] : [b, a];
  return { price: low, priceMax: high > low ? high : null };
}

/** Справжня календарна дата YYYY-MM-DD: 2026-02-31 і 2026-13-45 не проходять. */
export const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
};

/** Лише звичайні веб-адреси: javascript:, data: та інше в посилання не потрапляє. */
export const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > LIMITS.urlLength) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
  } catch {
    return false;
  }
};

/** Те, що людина вставила в поле посилання. Без протоколу додаємо https://. Не адреса → null. */
export function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  return isHttpUrl(withScheme) ? withScheme : null;
}
