/*
 * Марки пального на заправці. Зберігаються кодами, а назви — у словниках інтерфейсу,
 * бо «ДП літнє», «ДТ летнее» і «Diesel (summer)» — одне й те саме пальне.
 */

export const FUEL_GROUPS = {
  petrol: ["A92", "A95", "A95P", "A98", "A100", "A100P", "E5", "E10", "E85"],
  gas: ["LPG", "CNG"],
  diesel: ["DT", "DTW", "DTP", "B7", "B10", "B20", "B30", "XTL"],
} as const;

export type FuelGroup = keyof typeof FUEL_GROUPS;
export type FuelGrade = (typeof FUEL_GROUPS)[FuelGroup][number];

export const FUEL_GROUP_KEYS = Object.keys(FUEL_GROUPS) as FuelGroup[];
export const FUEL_GRADES = FUEL_GROUP_KEYS.flatMap((g) => FUEL_GROUPS[g]) as FuelGrade[];

export const isFuelGrade = (v: unknown): v is FuelGrade => FUEL_GRADES.includes(v as FuelGrade);

export const groupOfGrade = (grade: FuelGrade): FuelGroup =>
  FUEL_GROUP_KEYS.find((g) => (FUEL_GROUPS[g] as readonly string[]).includes(grade)) ?? "petrol";

/**
 * Які групи пропонувати машині з відомим типом пального (профіль машини, shared/carProfile.ts).
 * Газ із бензином — обидві групи; невідомий тип — усе, розбите на групи.
 */
export function groupsForFuelType(fuelType: string | null | undefined): FuelGroup[] {
  switch (fuelType) {
    case "petrol":
      return ["petrol"];
    case "diesel":
      return ["diesel"];
    case "lpg_petrol":
      return ["gas", "petrol"];
    case "lpg":
      return ["gas"];
    default:
      return FUEL_GROUP_KEYS;
  }
}

/** Наступна заправка пропонує ту саму марку, що й остання заправка цієї машини з указаною маркою. */
export const lastGrade = (fuel: { car: string; date: string; odo: number; grade: FuelGrade | null }[], car: string): FuelGrade | null =>
  [...fuel]
    .filter((f) => f.car === car && f.grade)
    .sort((a, b) => b.odo - a.odo || b.date.localeCompare(a.date))[0]?.grade ?? null;
