const stripUnits = (value: string): string =>
  value
    .replace(/[\s   ]/g, "")
    .replace(/₴/g, "")
    .replace(/грн\.?/gi, "")
    .replace(/км/gi, "")
    .replace(/л/gi, "");

/** Пробіг: крапки й коми — це лише роздільники тисяч. Порожньо → null, сміття → NaN. */
export function parseOdo(raw: string): number | null {
  const value = stripUnits(raw).replace(/[.,]/g, "");
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return NaN;
  return Number(value);
}

/**
 * Дробове число за правилами специфікації:
 * - кома і крапка разом: десятковий той, що останній;
 * - один роздільник кілька разів: тисячі;
 * - для грошей один роздільник і рівно 3 цифри після нього: теж тисячі;
 * - інакше: десятковий.
 */
export function parseDecimal(raw: string, opts: { money?: boolean } = {}): number | null {
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

  if (!/^\d*\.?\d+$/.test(value)) return NaN;
  return Number(value);
}

export const parseMoney = (raw: string): number | null => parseDecimal(raw, { money: true });
