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
      return { ...data, service: upsert(data.service, op.data) };
    case "service.del":
      return {
        ...data,
        service: data.service.filter((r) => r.id !== op.id),
        photos: data.photos.filter((p) => p.recordId !== op.id),
      };
    case "fuel.put":
      return { ...data, fuel: upsert(data.fuel, op.data) };
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
