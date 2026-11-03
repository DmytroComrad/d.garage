import { carSummary, fuelCalcs, fuelSummary, type CarSummary, type FuelCalc, type FuelSummary } from "../../shared/calc";
import type { Prefs } from "../../shared/prefs";
import { sortReminders, type RemindersRow } from "../../shared/reminders";
import type { FuelRecord, GarageData, Photo, Reminder, ServiceRecord, Wish } from "../../shared/types";

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
  /** Спершу невиконані (у порядку додавання), потім виконані (свіжі зверху). */
  wishes: Wish[];
  /** Запис витрат, створений із хотілки, якщо він ще існує. */
  wishRecords: Map<string, ServiceRecord>;
  /** Записи, чия хотілка знову невиконана: їх варто видалити. Ключ — id запису. */
  staleRecords: Map<string, Wish>;
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

  const serviceById = new Map(data.service.map((r) => [r.id, r]));
  const wishes = data.wishes
    .filter((w) => w.car === carId)
    .sort((a, b) =>
      a.done !== b.done
        ? Number(a.done) - Number(b.done)
        : a.done
          ? (b.doneDate ?? "").localeCompare(a.doneDate ?? "")
          : a.added.localeCompare(b.added) || a.id.localeCompare(b.id),
    );
  const wishRecords = new Map<string, ServiceRecord>();
  for (const w of wishes) {
    const record = w.recordId ? serviceById.get(w.recordId) : undefined;
    if (record) wishRecords.set(w.id, record);
  }
  // Хотілка могла бути в іншої машини, ніж запис (запис перенесли): шукаємо по всіх.
  const ownIds = new Set(service.map((r) => r.id));
  const staleRecords = new Map<string, Wish>();
  for (const w of data.wishes) {
    if (!w.done && w.recordId && ownIds.has(w.recordId)) staleRecords.set(w.recordId, w);
  }

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
    wishes,
    wishRecords,
    staleRecords,
  };
}

const views = new WeakMap<GarageData, Map<string, CarView>>();

/**
 * Той самий об'єкт, доки не змінились дані, машина, день чи налаштування: компоненти можуть рендеритись
 * скільки завгодно. Налаштування в ключі, бо від мови й одиниць залежать тексти та пороги нагадувань.
 */
export function carView(data: GarageData, carId: string, today: string, prefs: Prefs): CarView {
  let perData = views.get(data);
  if (!perData) {
    perData = new Map();
    views.set(data, perData);
  }
  const key = `${carId}|${today}|${prefs.lang}|${prefs.unit}`;
  let view = perData.get(key);
  if (!view) {
    view = buildCarView(data, carId, today);
    perData.set(key, view);
  }
  return view;
}
