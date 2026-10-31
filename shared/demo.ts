import { genId } from "./format";
import type { Car, FuelRecord, ServiceRecord } from "./types";

/** Приклад гаража: цифри з критеріїв приймання, назви знеособлені. */
export function demoRecords(): { car: Car; service: ServiceRecord[]; fuel: FuelRecord[] } {
  const car: Car = { id: genId(), name: "Демо-машина" };
  const svc = (date: string, odo: number, cat: string, what: string, where: string, sum: number): ServiceRecord => ({
    id: genId(),
    car: car.id,
    date,
    odo,
    cat,
    what,
    where,
    sum,
    note: "",
    items: [],
  });
  const fl = (date: string, odo: number, liters: number, sum: number, station: string): FuelRecord => ({
    id: genId(),
    car: car.id,
    date,
    odo,
    liters,
    sum,
    station,
    full: true,
    note: "",
  });
  return {
    car,
    service: [
      svc("2026-08-17", 327460, "Ремонт", "Замена компрессора кондиционера, радиатора кондиционера, уплотнений", "Автосервис", 4305),
      svc("2026-08-17", 327460, "ТО / расходники", "Замена ремня ГРМ, помпы, ремня ГУР, ремня генератора", "Автосервис", 8595),
      svc("2026-08-25", 327765, "ТО / расходники", "Заправка кондиционера, мойка + чистка салона", "Детейлинг", 8620),
    ],
    fuel: [
      fl("2026-08-21", 327599, 37.74, 2939.95, "АЗС на трассе"),
      fl("2026-08-31", 328030, 33.8, 2633.02, "АЗС у дома"),
    ],
  };
}
