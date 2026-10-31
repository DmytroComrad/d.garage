import { carSummary, fuelCalcs, fuelSummary, type CarSummary, type FuelCalc, type FuelSummary } from "../../shared/calc";
import { sortReminders, type RemindersRow } from "../../shared/reminders";
import type { FuelRecord, GarageData, Photo, Reminder, ServiceRecord } from "../../shared/types";

/** Усе, що екрани показують про одну машину. Рахується один раз на зміну даних. */
export type CarView = {
  service: ServiceRecord[];
  fuel: FuelRecord[];
  photos: Photo[];
  photosByRecord: Map<string, Photo[]>;
  summary: CarSummary;
  calcs: Map<string, FuelCalc>;
  fuelTotals: FuelSummary;
  activeReminders: RemindersRow[];
  urgentReminders: RemindersRow[];
  doneReminders: Reminder[];
};

export const NO_PHOTOS: Photo[] = [];

function buildCarView(data: GarageData, carId: string, today: string): CarView {
  const service = data.service.filter((r) => r.car === carId);
  const fuel = data.fuel.filter((r) => r.car === carId);
  const photos = data.photos.filter((p) => p.car === carId);
  const reminders = data.reminders.filter((r) => r.car === carId);

  const photosByRecord = new Map<string, Photo[]>();
  for (const photo of photos) {
    if (!photo.recordId) continue;
    const list = photosByRecord.get(photo.recordId);
    if (list) list.push(photo);
    else photosByRecord.set(photo.recordId, [photo]);
  }

  const summary = carSummary(service, fuel, today);
  const calcs = fuelCalcs(fuel);
  const activeReminders = sortReminders(
    reminders.filter((r) => !r.done),
    summary.currentOdo,
    today,
  );

  return {
    service,
    fuel,
    photos,
    photosByRecord,
    summary,
    calcs,
    fuelTotals: fuelSummary(fuel, calcs),
    activeReminders,
    urgentReminders: activeReminders.filter((r) => r.status.level > 0),
    doneReminders: reminders
      .filter((r) => r.done)
      .sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? "")),
  };
}

const views = new WeakMap<GarageData, Map<string, CarView>>();

/** Той самий об'єкт, доки не змінились дані, машина чи день: компоненти можуть рендеритись скільки завгодно. */
export function carView(data: GarageData, carId: string, today: string): CarView {
  let perData = views.get(data);
  if (!perData) {
    perData = new Map();
    views.set(data, perData);
  }
  const key = `${carId}|${today}`;
  let view = perData.get(key);
  if (!view) {
    view = buildCarView(data, carId, today);
    perData.set(key, view);
  }
  return view;
}
