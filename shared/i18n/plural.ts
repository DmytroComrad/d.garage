/** Українська й російська: 1 машина, 2 машини, 5 машин. */
export const plural3 = (n: number, forms: [string, string, string]): string => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
};

/** Англійська: 1 record, 2 records. */
export const plural2 = (n: number, one: string, other: string): string => (Math.abs(n) === 1 ? one : other);
