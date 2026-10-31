import { LIMITS } from "./constants";

/** Результат розбору поля: число, порожньо або щось, що числом не є. */
export type Parsed = number | null | "invalid";

const stripUnits = (value: string): string =>
  value
    .replace(/[\s   ]/g, "")
    .replace(/₴/g, "")
    .replace(/грн\.?/gi, "")
    .replace(/км/gi, "")
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

/** Справжня календарна дата YYYY-MM-DD: 2026-02-31 і 2026-13-45 не проходять. */
export const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
};
