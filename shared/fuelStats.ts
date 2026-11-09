import { sumMoney } from "./calc";
import type { FuelRecord } from "./types";

/*
 * Статистика за АЗС і марками пального.
 * Ціна літра — з усіх заправок групи. Витрата — лише з «чистих» відрізків між повними баками:
 * пальне, яке спалили на відрізку, залили на попередньому повному баку й на неповних між ними.
 * Якщо всі ці заправки з однієї групи, відрізок зараховуємо їй; змішаний відрізок не зараховуємо нікому.
 */

export type FuelGroupStat = {
  key: string;
  fills: number;
  liters: number;
  spent: number;
  /** Середня ціна літра: витрачене ÷ залите. */
  avgPrice: number | null;
  /** л/100 км, зважено за відстанню; null, якщо чистих відрізків ще немає. */
  consumption: number | null;
  /** Кілометри чистих відрізків, з яких порахована витрата. */
  distance: number;
};

const byOdoThenDate = (a: FuelRecord, b: FuelRecord): number => a.odo - b.odo || a.date.localeCompare(b.date);

export function fuelGroups(fuel: FuelRecord[], keyOf: (r: FuelRecord) => string | null): FuelGroupStat[] {
  type Acc = { fills: number; ml: number; spent: number[]; burnedMl: number; distance: number };
  const groups = new Map<string, Acc>();
  const acc = (key: string): Acc => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { fills: 0, ml: 0, spent: [], burnedMl: 0, distance: 0 }));
    return g;
  };

  for (const r of fuel) {
    const key = keyOf(r);
    if (!key) continue;
    const g = acc(key);
    g.fills++;
    g.ml += Math.round(r.liters * 1000);
    g.spent.push(r.sum);
  }

  const sorted = [...fuel].sort(byOdoThenDate);
  let lastFull: number | null = null;
  for (let i = 0; i < sorted.length; i++) {
    if (!sorted[i].full) continue;
    if (lastFull !== null) {
      const distance = sorted[i].odo - sorted[lastFull].odo;
      const keys = new Set(sorted.slice(lastFull, i).map(keyOf));
      const [key] = keys;
      if (distance > 0 && keys.size === 1 && key) {
        const g = acc(key);
        g.burnedMl += sorted.slice(lastFull + 1, i + 1).reduce((sum, r) => sum + Math.round(r.liters * 1000), 0);
        g.distance += distance;
      }
    }
    lastFull = i;
  }

  return [...groups.entries()]
    .filter(([, g]) => g.fills > 0)
    .map(([key, g]) => {
      const liters = g.ml / 1000;
      const spent = sumMoney(g.spent);
      return {
        key,
        fills: g.fills,
        liters,
        spent,
        avgPrice: liters > 0 ? spent / liters : null,
        consumption: g.distance > 0 ? (g.burnedMl / 1000 / g.distance) * 100 : null,
        distance: g.distance,
      };
    })
    .sort((a, b) => b.fills - a.fills || a.key.localeCompare(b.key));
}

export type FuelFact =
  | { kind: "price"; cheap: string; dear: string; diff: number }
  | { kind: "consumption"; low: string; high: string; lowValue: number; highValue: number };

/**
 * Короткі висновки для людини. Лише там, де даних досить: по дві заправки на групу для ціни
 * і щонайменше 300 км чистих відрізків для витрати, інакше одна заправка вирішувала б усе.
 */
export function fuelFacts(stats: FuelGroupStat[], minFills = 2, minDistance = 300): FuelFact[] {
  const facts: FuelFact[] = [];
  const priced = stats.filter((s) => s.fills >= minFills && s.avgPrice !== null);
  if (priced.length >= 2) {
    const sorted = [...priced].sort((a, b) => (a.avgPrice ?? 0) - (b.avgPrice ?? 0));
    const cheap = sorted[0];
    const dear = sorted[sorted.length - 1];
    const diff = Math.round(((dear.avgPrice ?? 0) - (cheap.avgPrice ?? 0)) * 100) / 100;
    if (diff >= 0.01) facts.push({ kind: "price", cheap: cheap.key, dear: dear.key, diff });
  }
  const measured = stats.filter((s) => s.distance >= minDistance && s.consumption !== null);
  if (measured.length >= 2) {
    const sorted = [...measured].sort((a, b) => (a.consumption ?? 0) - (b.consumption ?? 0));
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    if ((high.consumption ?? 0) - (low.consumption ?? 0) >= 0.1) {
      facts.push({ kind: "consumption", low: low.key, high: high.key, lowValue: low.consumption ?? 0, highValue: high.consumption ?? 0 });
    }
  }
  return facts;
}

/** Назва АЗС для групування: без регістру й зайвих пробілів, але показуємо так, як записано вперше. */
export const stationKey = (station: string): string | null => {
  const key = station.trim().replace(/\s+/g, " ");
  return key ? key.toLocaleLowerCase("uk-UA") : null;
};
