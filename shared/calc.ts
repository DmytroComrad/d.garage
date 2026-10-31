import type { FuelRecord, ItemKind, ServiceRecord } from "./types";

/** Сума грошей у копійках, щоб не накопичувати похибку плаваючої коми. */
export const sumMoney = (values: number[]): number =>
  values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100;

/** Літри до трьох знаків: рахуємо в мілілітрах з тієї ж причини. */
const sumLiters = (values: number[]): number =>
  values.reduce((acc, v) => acc + Math.round(v * 1000), 0) / 1000;

export type FuelCalc = {
  price: number;
  sinceLast: number | null;
  consumption: number | null;
};

const byOdoThenDate = (a: FuelRecord, b: FuelRecord): number =>
  a.odo - b.odo || a.date.localeCompare(b.date);

/**
 * Розрахунки для кожної заправки (п. 2.1). Заправки — лише однієї машини.
 * Один прохід за пробігом із накопиченням літрів. Заправки з однаковим пробігом
 * обробляються групою: межа «odo ≤ поточний» включає їх усі.
 */
export function fuelCalcs(fuel: FuelRecord[]): Map<string, FuelCalc> {
  const sorted = [...fuel].sort(byOdoThenDate);
  const out = new Map<string, FuelCalc>();

  let totalMl = 0;
  let prevOdo: number | null = null;
  let lastFullOdo: number | null = null;
  let totalMlAtLastFull = 0;

  for (let start = 0; start < sorted.length; ) {
    const odo = sorted[start].odo;
    let end = start;
    let groupHasFull = false;
    while (end < sorted.length && sorted[end].odo === odo) {
      totalMl += Math.round(sorted[end].liters * 1000);
      groupHasFull ||= sorted[end].full;
      end++;
    }

    for (let i = start; i < end; i++) {
      const rec = sorted[i];
      out.set(rec.id, {
        price: rec.liters > 0 ? rec.sum / rec.liters : 0,
        sinceLast: prevOdo == null ? null : odo - prevOdo,
        consumption:
          rec.full && lastFullOdo != null ? ((totalMl - totalMlAtLastFull) / 1000 / (odo - lastFullOdo)) * 100 : null,
      });
    }

    prevOdo = odo;
    if (groupHasFull) {
      lastFullOdo = odo;
      totalMlAtLastFull = totalMl;
    }
    start = end;
  }
  return out;
}

export type FuelPoint = { id: string; date: string; odo: number; station: string; value: number };

export type FuelSummary = {
  avg: number | null;
  last: number | null;
  count: number;
  liters: number;
  spent: number;
  avgPrice: number | null;
  perKm: number | null;
  points: FuelPoint[];
};

/** Зведення по пальному (п. 2.2). */
export function fuelSummary(fuel: FuelRecord[], calcs: Map<string, FuelCalc> = fuelCalcs(fuel)): FuelSummary {
  const fulls = fuel.filter((f) => f.full).sort(byOdoThenDate);

  let avg: number | null = null;
  if (fulls.length >= 2) {
    const first = fulls[0].odo;
    const last = fulls[fulls.length - 1].odo;
    if (last > first) {
      const liters = sumLiters(fuel.filter((f) => f.odo > first && f.odo <= last).map((f) => f.liters));
      avg = (liters / (last - first)) * 100;
    }
  }

  const points = fuel
    .flatMap((f) => {
      const value = calcs.get(f.id)?.consumption;
      return value == null ? [] : [{ id: f.id, date: f.date, odo: f.odo, station: f.station, value }];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.odo - b.odo);

  const liters = sumLiters(fuel.map((f) => f.liters));
  const spent = sumMoney(fuel.map((f) => f.sum));
  const avgPrice = liters > 0 ? spent / liters : null;

  return {
    avg,
    last: points.length ? points[points.length - 1].value : null,
    count: fuel.length,
    liters,
    spent,
    avgPrice,
    perKm: avg != null && avgPrice != null ? (avg / 100) * avgPrice : null,
    points,
  };
}

export type CategoryRow = { name: string; sum: number; share: number };

export type CarSummary = {
  serviceTotal: number;
  fuelTotal: number;
  total: number;
  thisYear: number;
  currentOdo: number | null;
  startOdo: number | null;
  since: string | null;
  driven: number | null;
  perKm: number | null;
  lastService: ServiceRecord | null;
  categories: CategoryRow[];
  hasRecords: boolean;
};

/** Зведення по машині (п. 2.3). */
export function carSummary(service: ServiceRecord[], fuel: FuelRecord[], today: string): CarSummary {
  const serviceTotal = sumMoney(service.map((r) => r.sum));
  const fuelTotal = sumMoney(fuel.map((r) => r.sum));
  const total = sumMoney([serviceTotal, fuelTotal]);

  const yearStart = `${today.slice(0, 4)}-01-01`;
  const thisYear = sumMoney(
    [...service, ...fuel].filter((r) => r.date >= yearStart).map((r) => r.sum),
  );

  const odos = [...service.map((r) => r.odo), ...fuel.map((r) => r.odo)].filter(
    (v): v is number => v != null,
  );
  const currentOdo = odos.length ? Math.max(...odos) : null;
  const startOdo = odos.length ? Math.min(...odos) : null;
  const driven = currentOdo != null && startOdo != null ? currentOdo - startOdo : null;

  const dates = [...service, ...fuel].map((r) => r.date).sort();
  const since = dates.length ? dates[0] : null;

  const lastService = service.length
    ? [...service].sort(
        (a, b) => b.date.localeCompare(a.date) || (b.odo ?? -1) - (a.odo ?? -1),
      )[0]
    : null;

  const byCat = new Map<string, number[]>();
  for (const r of service) {
    const sums = byCat.get(r.cat);
    if (sums) sums.push(r.sum);
    else byCat.set(r.cat, [r.sum]);
  }
  const categories = [...byCat.entries()]
    .map(([name, sums]) => ({ name, sum: sumMoney(sums) }))
    .filter((c) => c.sum !== 0)
    .sort((a, b) => b.sum - a.sum)
    .map((c) => ({ ...c, share: serviceTotal > 0 ? (c.sum / serviceTotal) * 100 : 0 }));

  return {
    serviceTotal,
    fuelTotal,
    total,
    thisYear,
    currentOdo,
    startOdo,
    since,
    driven,
    perKm: driven != null && driven > 0 ? total / driven : null,
    lastService,
    categories,
    hasRecords: service.length + fuel.length > 0,
  };
}

export type MonthRow = { key: string; service: number; fuel: number; total: number; liters: number };

const monthKey = (y: number, m: number): string => `${y}-${String(m + 1).padStart(2, "0")}`;

/** По місяцях (п. 2.4): до 12 останніх, що закінчуються поточним, не раніше першого запису. */
export function monthly(service: ServiceRecord[], fuel: FuelRecord[], today: string): MonthRow[] {
  const dates = [...service, ...fuel].map((r) => r.date).sort();
  const nowY = Number(today.slice(0, 4));
  const nowM = Number(today.slice(5, 7)) - 1;

  const keys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(nowY, nowM - i, 1));
    keys.push(monthKey(d.getUTCFullYear(), d.getUTCMonth()));
  }
  const firstKey = dates.length ? dates[0].slice(0, 7) : keys[keys.length - 1];
  const visible = keys.filter((k) => k >= firstKey);
  const months = visible.length ? visible : [keys[keys.length - 1]];

  return months.map((key) => {
    const svc = service.filter((r) => r.date.startsWith(key));
    const fl = fuel.filter((r) => r.date.startsWith(key));
    const serviceSum = sumMoney(svc.map((r) => r.sum));
    const fuelSum = sumMoney(fl.map((r) => r.sum));
    return {
      key,
      service: serviceSum,
      fuel: fuelSum,
      total: sumMoney([serviceSum, fuelSum]),
      liters: sumLiters(fl.map((r) => r.liters)),
    };
  });
}

export type KindRow = { kind: ItemKind | "none"; sum: number };

/** Куди йдуть гроші в сервісних записах: запчастини, робота, інше, без розбивки. */
export function itemKindTotals(service: ServiceRecord[]): KindRow[] {
  const acc: Record<KindRow["kind"], number[]> = { parts: [], labor: [], extra: [], none: [] };
  for (const r of service) {
    if (r.items.length) for (const it of r.items) acc[it.kind].push(it.sum);
    else acc.none.push(r.sum);
  }
  return (Object.keys(acc) as KindRow["kind"][])
    .map((kind) => ({ kind, sum: sumMoney(acc[kind]) }))
    .filter((row) => row.sum > 0);
}

/** Крок осі: "гарне" число від max/4 (1, 2, 2,5, 5 × 10ⁿ). */
export function niceStep(max: number): number {
  if (max <= 0) return 1;
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * pow;
}

export const fuelChipTone = (value: number | null, avg: number | null): "good" | "bad" | "neutral" => {
  if (value == null || avg == null) return "neutral";
  if (value <= avg * 0.97) return "good";
  if (value >= avg * 1.03) return "bad";
  return "neutral";
};
