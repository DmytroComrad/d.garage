import { genId } from "./format";
import { messages } from "./i18n";
import type { Car, CarProfile, FuelRecord, ServiceRecord, Wish } from "./types";

/** Приклад гаража: цифри з критеріїв приймання, назви знеособлені й перекладені мовою інтерфейсу. */
export function demoRecords(today: string): {
  car: Car;
  profile: CarProfile;
  service: ServiceRecord[];
  fuel: FuelRecord[];
  wishes: Wish[];
} {
  const t = messages().demo;
  const car: Car = { id: genId(), name: t.car };
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
    grade: "A95",
  });
  const wish = (title: string, price: number, note = ""): Wish => ({
    id: genId(),
    car: car.id,
    title,
    price,
    priceMax: null,
    links: [],
    note,
    added: today,
    done: false,
    doneDate: null,
    recordId: null,
  });
  return {
    car,
    // Номер умовний, а VIN не вказуємо: вигаданий міг би збігтися з чиєюсь справжньою машиною.
    profile: {
      year: 2008,
      vin: null,
      plate: "AA 1234 BB",
      body: "liftback",
      engine: 1.8,
      fuelType: "lpg_petrol",
      purchaseDate: "2019-04-12",
      purchasePrice: 185000,
      about: t.about,
    },
    service: [
      svc("2026-08-17", 327460, "Ремонт", t.acRepair, t.shop, 4305),
      svc("2026-08-17", 327460, "ТО / расходники", t.timingBelt, t.shop, 8595),
      svc("2026-08-25", 327765, "ТО / расходники", t.detailing, t.detailer, 8620),
    ],
    fuel: [fl("2026-08-21", 327599, 37.74, 2939.95, t.highway), fl("2026-08-31", 328030, 33.8, 2633.02, t.nearHome)],
    wishes: [wish(t.winterTires, 14000, t.winterTiresNote), wish(t.dashcam, 3500)],
  };
}
