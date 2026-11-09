import { describe, expect, it } from "vitest";
import { groupsForFuelType, lastGrade } from "../../shared/fuelGrades";
import { fuelFacts, fuelGroups, stationKey } from "../../shared/fuelStats";
import type { FuelRecord } from "../../shared/types";

let n = 0;
const fill = (odo: number, liters: number, sum: number, station: string, grade: FuelRecord["grade"] = "A95", full = true): FuelRecord => ({
  id: `f${++n}`,
  car: "c1",
  date: `2026-01-${String(10 + (n % 18)).padStart(2, "0")}`,
  odo,
  liters,
  sum,
  station,
  full,
  note: "",
  grade,
});

describe("статистика за АЗС і марками", () => {
  it("ціна літра — з усіх заправок групи, назви АЗС без регістру й зайвих пробілів", () => {
    const stats = fuelGroups(
      [fill(1000, 40, 2000, "WOG"), fill(1500, 30, 1560, " wog "), fill(2000, 40, 2200, "OKKO")],
      (r) => stationKey(r.station),
    );
    expect(stats.map((s) => [s.key, s.fills, s.liters, s.spent, Math.round((s.avgPrice ?? 0) * 100) / 100])).toEqual([
      ["wog", 2, 70, 3560, 50.86],
      ["okko", 1, 40, 2200, 55],
    ]);
  });

  it("витрату відрізка рахуємо тій групі, з чиїх заправок було пальне в баку", () => {
    // 1000 → 1500 км: у баку пальне з WOG, долили 40 л → 8 л/100. 1500 → 2000: пальне з OKKO, 35 л → 7 л/100.
    const stats = fuelGroups(
      [fill(1000, 50, 2500, "WOG"), fill(1500, 40, 2000, "OKKO"), fill(2000, 35, 1800, "WOG")],
      (r) => stationKey(r.station),
    );
    const by = Object.fromEntries(stats.map((s) => [s.key, s]));
    expect(by.wog.consumption).toBeCloseTo(8);
    expect(by.wog.distance).toBe(500);
    expect(by.okko.consumption).toBeCloseTo(7);
  });

  it("змішаний відрізок (неповний бак з іншої АЗС) не зараховується нікому", () => {
    const stats = fuelGroups(
      [fill(1000, 50, 2500, "WOG"), fill(1200, 10, 500, "OKKO", "A95", false), fill(1600, 45, 2250, "WOG")],
      (r) => stationKey(r.station),
    );
    expect(stats.every((s) => s.consumption === null && s.distance === 0)).toBe(true);
  });

  it("заправки без АЗС чи марки в групи не потрапляють", () => {
    expect(fuelGroups([fill(1000, 40, 2000, ""), fill(1500, 40, 2000, "", null)], (r) => stationKey(r.station))).toEqual([]);
    expect(fuelGroups([fill(1000, 40, 2000, "", null)], (r) => r.grade)).toEqual([]);
  });

  it("висновки лише там, де даних досить", () => {
    const stats = [
      { key: "wog", fills: 3, liters: 120, spent: 6000, avgPrice: 50, consumption: 8.2, distance: 1500 },
      { key: "okko", fills: 2, liters: 80, spent: 4320, avgPrice: 54, consumption: 7.6, distance: 900 },
      { key: "rare", fills: 1, liters: 40, spent: 1600, avgPrice: 40, consumption: 5, distance: 100 },
    ];
    expect(fuelFacts(stats)).toEqual([
      { kind: "price", cheap: "wog", dear: "okko", diff: 4 },
      { kind: "consumption", low: "okko", high: "wog", lowValue: 7.6, highValue: 8.2 },
    ]);
    expect(fuelFacts(stats.slice(0, 1))).toEqual([]);
  });
});

describe("марки пального", () => {
  it("тип пального машини звужує список, невідомий — показує все", () => {
    expect(groupsForFuelType("diesel")).toEqual(["diesel"]);
    expect(groupsForFuelType("lpg_petrol")).toEqual(["gas", "petrol"]);
    expect(groupsForFuelType(null)).toEqual(["petrol", "gas", "diesel"]);
  });

  it("нова заправка пропонує марку з останньої заправки цієї машини", () => {
    const fuel = [fill(1000, 40, 2000, "", "A92"), fill(2000, 40, 2000, "", null), fill(1500, 40, 2000, "", "A95")];
    expect(lastGrade(fuel, "c1")).toBe("A95");
    expect(lastGrade(fuel, "other")).toBeNull();
  });
});
