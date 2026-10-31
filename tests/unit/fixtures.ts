import type { FuelRecord, ServiceRecord } from "../../shared/types";

export const CAR = "car1";

const svc = (id: string, date: string, odo: number | null, cat: string, what: string, sum: number): ServiceRecord => ({
  id, car: CAR, date, odo, cat, what, where: "Автосервис", sum, note: "", items: [],
});

const fl = (id: string, date: string, odo: number, liters: number, sum: number, full = true): FuelRecord => ({
  id, car: CAR, date, odo, liters, sum, station: "АЗС", full, note: "",
});

export const service: ServiceRecord[] = [
  svc("s1", "2026-08-17", 327460, "Ремонт", "Кондиционер", 4305),
  svc("s2", "2026-08-17", 327460, "ТО / расходники", "ГРМ", 8595),
  svc("s3", "2026-08-25", 327765, "ТО / расходники", "Мойка", 8620),
];

export const fuel: FuelRecord[] = [
  fl("f1", "2026-08-21", 327599, 37.74, 2939.95),
  fl("f2", "2026-08-31", 328030, 33.8, 2633.02),
];

export const partial = [
  fl("f3", "2026-09-05", 328300, 20, 1558, false),
  fl("f4", "2026-09-10", 328600, 30, 2337),
];
