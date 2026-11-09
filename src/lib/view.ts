import { carSummary, fuelCalcs, fuelSummary, type CarSummary, type FuelCalc, type FuelSummary } from "../../shared/calc";
import {
  convert,
  recordIn,
  totalIn,
  wishIn,
  type Currency,
  type FxRates,
  type Priced,
  type Total,
} from "../../shared/currency";
import { currencyPrefs, type CurrencyPrefs, type Prefs } from "../../shared/prefs";
import { sortReminders, type RemindersRow } from "../../shared/reminders";
import type { FuelRecord, GarageData, Photo, Reminder, ServiceRecord, Wish } from "../../shared/types";

/** Основна валюта й перерахунок у неї будь-яких записів машини: суми місяців, фільтра, хотілок. */
export type Money = {
  main: Currency;
  /** Сума записів в основній валюті, кожен — за курсом на свою дату. */
  total: (records: readonly Priced[]) => Total;
  /** Сума одного запису в основній валюті, без курсу — 0: для сортування за сумою. */
  sumOf: (record: Priced) => number;
  /** Хотілка з ціною в основній валюті за курсом на день, коли її додали; null — курсу немає. */
  wish: (wish: Wish) => Wish | null;
};

/**
 * Усе, що екрани показують про одну машину. Рахується один раз на зміну даних.
 * Записи лишаються у своїх валютах, а для підсумків їх перераховано в основну за курсом НБУ
 * на дату кожного запису: функції з shared/calc.ts про валюти не знають.
 */
export type CarView = {
  service: ServiceRecord[];
  fuel: FuelRecord[];
  /** Ті самі записи з сумами в основній валюті: для статистики, зведень і підсумків. */
  serviceMain: ServiceRecord[];
  fuelMain: FuelRecord[];
  photos: Photo[];
  photosByRecord: Map<string, Photo[]>;
  /** Зведення в основній валюті. */
  summary: CarSummary;
  /** Підсумки в основній валюті разом із тим, що без курсу перерахувати не вдалося. */
  totals: { all: Total; service: Total; fuel: Total; thisYear: Total };
  /** «Вкладено всього» в додатковій валюті, якщо її вибрано: теж за курсом на дату кожного запису. */
  second: { currency: Currency; total: Total } | null;
  /** Ціна літра — у валюті самої заправки. */
  calcs: Map<string, FuelCalc>;
  /** Зведення по пальному в основній валюті. */
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
  money: Money;
};

export const NO_PHOTOS: Photo[] = [];

function buildCarView(data: GarageData, carId: string, today: string, cur: CurrencyPrefs, rates: FxRates): CarView {
  const service = data.service.filter((r) => r.car === carId);
  const fuel = data.fuel.filter((r) => r.car === carId);
  const main = cur.main;
  const serviceMain = service.map((r) => recordIn(r, main, rates));
  const fuelMain = fuel.map((r) => recordIn(r, main, rates));
  const inMain = new Map<Priced, number>();
  service.forEach((r, i) => inMain.set(r, serviceMain[i].sum));
  fuel.forEach((r, i) => inMain.set(r, fuelMain[i].sum));
  const money: Money = {
    main,
    total: (records) => totalIn(records, main, rates),
    sumOf: (r) => inMain.get(r) ?? convert(r.sum, r.currency, main, r.date, rates) ?? 0,
    wish: (w) => wishIn(w, main, rates),
  };
  const all = [...service, ...fuel];
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const photos = data.photos.filter((p) => p.car === carId);
  const reminders = data.reminders.filter((r) => r.car === carId);

  const photosByRecord = new Map<string, Photo[]>();
  for (const photo of photos) {
    if (!photo.recordId) continue;
    const list = photosByRecord.get(photo.recordId);
    if (list) list.push(photo);
    else photosByRecord.set(photo.recordId, [photo]);
  }

  const summary = carSummary(serviceMain, fuelMain, today);
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
    serviceMain,
    fuelMain,
    photos,
    photosByRecord,
    summary,
    totals: {
      all: money.total(all),
      service: money.total(service),
      fuel: money.total(fuel),
      thisYear: money.total(all.filter((r) => r.date >= yearStart)),
    },
    second: cur.second ? { currency: cur.second, total: totalIn(all, cur.second, rates) } : null,
    calcs,
    // Витрата від валюти не залежить, тож розрахунки заправок підходять і перерахованим записам.
    fuelTotals: fuelSummary(fuelMain, calcs),
    activeReminders,
    urgentReminders: activeReminders.filter((r) => r.status.level > 0),
    doneReminders: reminders
      .filter((r) => r.done)
      .sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? "")),
    wishes,
    wishRecords,
    staleRecords,
    money,
  };
}

const views = new WeakMap<GarageData, WeakMap<FxRates, Map<string, CarView>>>();
const NO_RATES: FxRates = {};

/**
 * Той самий об'єкт, доки не змінились дані, курси, машина, день чи налаштування: компоненти можуть рендеритись
 * скільки завгодно. Налаштування в ключі, бо від мови, одиниць і валют залежать тексти, підсумки й пороги нагадувань.
 */
export function carView(data: GarageData, carId: string, today: string, prefs: Prefs, rates: FxRates = NO_RATES): CarView {
  let perData = views.get(data);
  if (!perData) {
    perData = new WeakMap();
    views.set(data, perData);
  }
  let perRates = perData.get(rates);
  if (!perRates) {
    perRates = new Map();
    perData.set(rates, perRates);
  }
  const cur = currencyPrefs(prefs);
  const key = `${carId}|${today}|${prefs.lang}|${prefs.unit}|${cur.main}|${cur.second ?? ""}`;
  let view = perRates.get(key);
  if (!view) {
    view = buildCarView(data, carId, today, cur, rates);
    perRates.set(key, view);
  }
  return view;
}
