import type { GarageData, Op } from "./types";

const upsert = <T extends { id: string }>(list: T[], item: T): T[] => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = [...list];
  next[i] = item;
  return next;
};

export const emptyData = (): GarageData => ({
  cars: [],
  service: [],
  fuel: [],
  reminders: [],
  photos: [],
  demo: false,
});

/** Запис переїхав на іншу машину: його фото й нагадування їдуть разом із ним. */
const moveLinked = (data: GarageData, recordId: string, car: string): Pick<GarageData, "photos" | "reminders"> => ({
  photos: data.photos.some((p) => p.recordId === recordId && p.car !== car)
    ? data.photos.map((p) => (p.recordId === recordId ? { ...p, car } : p))
    : data.photos,
  reminders: data.reminders.some((r) => r.recordId === recordId && r.car !== car)
    ? data.reminders.map((r) => (r.recordId === recordId ? { ...r, car } : r))
    : data.reminders,
});

/** Той самий ефект, що й на сервері: так інтерфейс оновлюється одразу, навіть без мережі. */
export function applyOp(data: GarageData, op: Op): GarageData {
  switch (op.type) {
    case "car.put":
      return { ...data, cars: upsert(data.cars, op.data) };
    case "car.del":
      return {
        ...data,
        cars: data.cars.filter((c) => c.id !== op.id),
        service: data.service.filter((r) => r.car !== op.id),
        fuel: data.fuel.filter((r) => r.car !== op.id),
        reminders: data.reminders.filter((r) => r.car !== op.id),
        photos: data.photos.filter((p) => p.car !== op.id),
      };
    case "service.put":
      return { ...data, service: upsert(data.service, op.data), ...moveLinked(data, op.data.id, op.data.car) };
    case "service.del":
      return {
        ...data,
        service: data.service.filter((r) => r.id !== op.id),
        photos: data.photos.filter((p) => p.recordId !== op.id),
      };
    case "fuel.put":
      return { ...data, fuel: upsert(data.fuel, op.data), ...moveLinked(data, op.data.id, op.data.car) };
    case "fuel.del":
      return {
        ...data,
        fuel: data.fuel.filter((r) => r.id !== op.id),
        photos: data.photos.filter((p) => p.recordId !== op.id),
      };
    case "reminder.put":
      return { ...data, reminders: upsert(data.reminders, op.data) };
    case "reminder.del":
      return { ...data, reminders: data.reminders.filter((r) => r.id !== op.id) };
    case "demo.set":
      return { ...data, demo: op.value };
    case "all.del":
      return emptyData();
  }
}

/** Операція для машини, яку об'єднали з іншою: переводимо її на справжній id. */
export function retargetOp(op: Op, aliases: ReadonlyMap<string, string>): Op {
  switch (op.type) {
    case "service.put": {
      const car = aliases.get(op.data.car);
      return car ? { ...op, data: { ...op.data, car } } : op;
    }
    case "fuel.put": {
      const car = aliases.get(op.data.car);
      return car ? { ...op, data: { ...op.data, car } } : op;
    }
    case "reminder.put": {
      const car = aliases.get(op.data.car);
      return car ? { ...op, data: { ...op.data, car } } : op;
    }
    case "car.del": {
      const id = aliases.get(op.id);
      return id ? { ...op, id } : op;
    }
    default:
      return op;
  }
}
