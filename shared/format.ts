const NBSP = " ";

const money0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtMoney0 = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : `${money0.format(n)}${NBSP}₴`;

export const fmtMoney = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : `${money2.format(n)}${NBSP}₴`;

export const fmtNum = (n: number): string => int.format(n);
export const fmtKm = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : `${int.format(n)}${NBSP}км`;

export const fmtDec1 = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : dec1.format(n);

export const fmtLiters = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : `${money2.format(n)}${NBSP}л`;

export const fmtLiters1 = (n: number): string => `${dec1.format(n)}${NBSP}л`;

export const fmtConsumption = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : `${dec1.format(n)}${NBSP}л/100`;

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
};

export const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];
export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** "2026-08" → "август 2026" */
export const fmtMonthKey = (key: string): string => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

export const plural = (n: number, forms: [string, string, string]): string => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
};

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
