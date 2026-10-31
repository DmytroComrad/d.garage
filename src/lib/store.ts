import { useSyncExternalStore } from "react";
import { mergeBackup, type RawBackup } from "../../shared/backup";
import { carSummary } from "../../shared/calc";
import { LIMITS } from "../../shared/constants";
import { demoRecords } from "../../shared/demo";
import { genId, todayISO } from "../../shared/format";
import { applyOp, emptyData } from "../../shared/ops";
import { remindersToNotify, type RemindersRow } from "../../shared/reminders";
import type {
  AppConfig,
  DriveStatus,
  FuelRecord,
  GarageData,
  Op,
  Photo,
  Reminder,
  ServiceRecord,
  User,
} from "../../shared/types";
import { HttpError, NetworkError, getJson, postJson } from "./api";

export type Tab = "service" | "fuel" | "reminders" | "gallery" | "stats" | "data";
export type Theme = "auto" | "light" | "dark";

export type Dialog =
  | { type: "fuel"; record?: FuelRecord; car?: string }
  | { type: "service"; record?: ServiceRecord; car?: string }
  | { type: "car" }
  | { type: "reminder"; reminder?: Reminder }
  | { type: "notify"; rows: RemindersRow[] }
  | { type: "account" }
  | { type: "copy"; text: string }
  | { type: "lightbox"; photos: Photo[]; index: number }
  | null;

export type AppState = {
  phase: "loading" | "anon" | "ready";
  resetToken: string | null;
  config: AppConfig;
  user: User | null;
  data: GarageData;
  drive: DriveStatus;
  active: string | null;
  tab: Tab;
  theme: Theme;
  queue: Op[];
  offline: boolean;
  storageOk: boolean;
  dialog: Dialog;
  toast: { id: number; text: string } | null;
  uploading: number;
};

const CACHE_KEY = "garage-amedro-v1";
const UI_KEY = "garage-ui";
const TABS: Tab[] = ["service", "fuel", "reminders", "gallery", "stats", "data"];

const noDrive: DriveStatus = { connected: false, email: null, sheetUrl: null, sheetExportedAt: null };

const readUi = (): { tab?: Tab; active?: string; theme?: Theme } => {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) ?? "{}");
  } catch {
    return {};
  }
};

const ui = readUi();

let state: AppState = {
  phase: "loading",
  resetToken: null,
  config: { googleLogin: false, drive: false, passwordReset: false, turnstileSiteKey: null },
  user: null,
  data: emptyData(),
  drive: noDrive,
  active: ui.active ?? null,
  tab: ui.tab && TABS.includes(ui.tab) ? ui.tab : "service",
  theme: ui.theme ?? "auto",
  queue: [],
  offline: false,
  storageOk: true,
  dialog: null,
  toast: null,
  uploading: 0,
};

const listeners = new Set<() => void>();

const setState = (patch: Partial<AppState>): void => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const getState = (): AppState => state;

export const useApp = (): AppState =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );

const saveUi = (): void => {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ tab: state.tab, active: state.active, theme: state.theme }));
  } catch {
    // Вибір вкладки не вартий банера.
  }
};

/** Копія на пристрої: щоб відкривалось миттєво і працювало без мережі. Правда живе на сервері. */
const saveCache = (): void => {
  if (!state.user) return;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ user: state.user, data: state.data, drive: state.drive, queue: state.queue }),
    );
    if (!state.storageOk) setState({ storageOk: true });
  } catch {
    // Черга без мережі живе лише в пам'яті: про це треба сказати.
    if (state.storageOk) setState({ storageOk: false });
  }
};

const readCache = (): Pick<AppState, "user" | "data" | "drive" | "queue"> | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/** Сесія закінчилась: дані з пристрою прибираємо, а незбережені зміни лишаємо до повторного входу. */
const dropCachedData = (): void => {
  if (!state.user || !state.queue.length) return clearCache();
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user: { id: state.user.id }, queue: state.queue }));
  } catch {
    clearCache();
  }
};

const clearCache = (): void => {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Нічого стирати.
  }
};

const ensureActive = (): void => {
  const { cars } = state.data;
  if (!cars.some((c) => c.id === state.active)) {
    setState({ active: cars[0]?.id ?? null });
    saveUi();
  }
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastSeq = 0;

export const toast = (text: string): void => {
  clearTimeout(toastTimer);
  setState({ toast: { id: ++toastSeq, text } });
  toastTimer = setTimeout(() => setState({ toast: null }), 2200);
};

export const setTab = (tab: Tab): void => {
  setState({ tab });
  saveUi();
};

export const setActive = (active: string): void => {
  setState({ active });
  saveUi();
  showDueReminders(active);
};

export const setTheme = (theme: Theme): void => {
  setState({ theme });
  saveUi();
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
};

/* Вікна. Кнопка «назад» на телефоні закриває вікно, а не сайт. */

export const openDialog = (dialog: Dialog): void => {
  if (!state.dialog) history.pushState({ dialog: true }, "");
  setState({ dialog });
};

export const closeDialog = (next: Dialog = null): void => {
  if (next) {
    setState({ dialog: next });
    return;
  }
  setState({ dialog: null });
  if (history.state?.dialog) history.back();
};

window.addEventListener("popstate", () => {
  if (state.dialog) setState({ dialog: null });
});

/* Синхронізація: зміна одразу видна в інтерфейсі, а на сервер іде через чергу. */

let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 3000;

const scheduleRetry = (): void => {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void flush(), retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60_000);
};

export async function flush(): Promise<void> {
  if (flushing || !state.user) return;
  flushing = true;
  let stale = false;
  try {
    while (state.queue.length) {
      const chunk = state.queue.slice(0, LIMITS.opsPerRequest);
      try {
        const { rejected } = await postJson<{ rejected: number[] }>("/api/ops", { ops: chunk });
        if (rejected.length) {
          stale = true;
          toast("Часть изменений не сохранилась: проверь записи.");
        }
        setState({ queue: state.queue.slice(chunk.length), offline: false });
        saveCache();
        retryDelay = 3000;
      } catch (err) {
        if (err instanceof HttpError && err.status === 401) {
          dropCachedData();
          setState({ phase: "anon", user: null, data: emptyData(), drive: noDrive, queue: [], dialog: null });
          return;
        }
        if (err instanceof HttpError && err.status < 500 && err.status !== 429) {
          // Сервер відмовив остаточно: повторювати безглуздо, інакше черга застрягне назавжди.
          setState({ queue: state.queue.slice(chunk.length) });
          saveCache();
          toast(err.message);
          stale = true;
          continue;
        }
        setState({ offline: true });
        scheduleRetry();
        return;
      }
    }
  } finally {
    flushing = false;
  }
  if (stale) await refresh();
}

export function dispatch(...ops: Op[]): void {
  let data = state.data;
  for (const op of ops) data = applyOp(data, op);
  setState({ data, queue: [...state.queue, ...ops] });
  ensureActive();
  saveCache();
  void flush();
}

type StateResponse = { user: User; data: GarageData; drive: DriveStatus };

export async function refresh(): Promise<void> {
  try {
    const res = await getJson<StateResponse>("/api/state");
    // Чужа черга (на пристрої збереглися зміни іншого акаунта) не має потрапити в цей гараж.
    const queue = state.user && state.user.id !== res.user.id ? [] : state.queue;
    // Операції, які ще не дійшли до сервера, накладаємо поверх свіжих даних.
    let data = res.data;
    for (const op of queue) data = applyOp(data, op);
    setState({ user: res.user, data, drive: res.drive, queue, phase: "ready", offline: false });
    ensureActive();
    saveCache();
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      dropCachedData();
      setState({ phase: "anon", user: null, data: emptyData(), drive: noDrive, queue: [], dialog: null });
      return;
    }
    if (err instanceof NetworkError || (err instanceof HttpError && err.status >= 500)) {
      setState({ offline: true });
    }
  }
}

const REDIRECT_MESSAGES: Record<string, string> = {
  "drive=connected": "Google Диск подключён",
  "drive=denied": "Доступ к Google Диску не выдан",
  "drive=scope": "Без галочки про файлы приложения Диск не подключить. Попробуй ещё раз.",
  "drive=error": "Не получилось подключить Google Диск. Попробуй ещё раз.",
  "google=denied": "Вход через Google отменён",
  "google=error": "Не получилось войти через Google. Попробуй ещё раз.",
  "google=state": "Сессия входа устарела. Попробуй ещё раз.",
  "google=unverified": "У этого аккаунта Google не подтверждена почта.",
  "google=linked": "Вход через Google привязан",
  "google=taken": "Этот аккаунт Google уже привязан к другому профилю.",
  "google=claimed": "Вход через Google привязан. Старый пароль отключён: новый можно задать в профиле.",
};

const consumeUrlParams = (): void => {
  const url = new URL(location.href);
  let message: string | undefined;
  for (const key of ["drive", "google"]) {
    const value = url.searchParams.get(key);
    if (value) {
      message = REDIRECT_MESSAGES[`${key}=${value}`] ?? message;
      url.searchParams.delete(key);
      if (key === "drive") setState({ tab: "data" });
    }
  }
  const reset = url.searchParams.get("reset");
  if (reset) {
    setState({ resetToken: reset });
    url.searchParams.delete("reset");
  }
  if (url.search !== location.search) history.replaceState(null, "", url.pathname + url.search);
  if (message) toast(message);
};

export async function boot(): Promise<void> {
  consumeUrlParams();
  void getJson<AppConfig>("/api/config")
    .then((config) => setState({ config }))
    .catch(() => undefined);

  const cached = readCache();
  if (cached?.user && cached.data) {
    setState({
      user: cached.user,
      data: cached.data,
      drive: cached.drive ?? noDrive,
      queue: cached.queue ?? [],
      phase: "ready",
    });
    ensureActive();
  }

  await refresh();
  if (state.phase === "loading") setState({ phase: state.user ? "ready" : "anon" });
  if (state.user) {
    await flush();
    if (state.active) showDueReminders(state.active);
  }

  window.addEventListener("online", () => void syncNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
}

export async function syncNow(): Promise<void> {
  if (!state.user) return;
  await flush();
  if (!state.queue.length) await refresh();
  if (state.active && !state.dialog) showDueReminders(state.active);
}

export async function afterAuth(): Promise<void> {
  const previous = readCache();
  await refresh();
  // Якщо сесія закінчилась посеред роботи, незбережені зміни того ж користувача не губимо.
  if (previous?.user?.id === state.user?.id && previous?.queue?.length) {
    let data = state.data;
    for (const op of previous.queue) data = applyOp(data, op);
    setState({ queue: previous.queue, data });
    await flush();
  } else if (previous?.user?.id !== state.user?.id) {
    saveCache();
  }
  if (state.active) showDueReminders(state.active);
}

export async function logout(everywhere = false): Promise<void> {
  try {
    await postJson(everywhere ? "/api/auth/logout-all" : "/api/auth/logout");
  } catch {
    // Локально все одно виходимо.
  }
  resetToAnon();
}

export const resetToAnon = (): void => {
  clearCache();
  if (history.state?.dialog) history.back();
  setState({ phase: "anon", user: null, data: emptyData(), drive: noDrive, queue: [], dialog: null, active: null });
};

export const setUser = (user: User): void => {
  setState({ user });
  saveCache();
};

export const setDrive = (drive: DriveStatus): void => {
  setState({ drive });
  saveCache();
};

export const addPhoto = (photo: Photo): void => {
  setState({ data: { ...state.data, photos: [...state.data.photos, photo] } });
  saveCache();
};

export const removePhoto = (id: string): void => {
  setState({ data: { ...state.data, photos: state.data.photos.filter((p) => p.id !== id) } });
  saveCache();
};

export const setUploading = (delta: number): void => setState({ uploading: Math.max(0, state.uploading + delta) });

/* Обчислення для вибраної машини */

export const carRecords = (data: GarageData, carId: string | null) => ({
  service: data.service.filter((r) => r.car === carId),
  fuel: data.fuel.filter((r) => r.car === carId),
  reminders: data.reminders.filter((r) => r.car === carId),
  photos: data.photos.filter((p) => p.car === carId),
});

export const currentOdo = (carId: string | null): number | null => {
  const { service, fuel } = carRecords(state.data, carId);
  return carSummary(service, fuel, todayISO()).currentOdo;
};

/** Запам'ятовує показане вікно, щоб той самий поріг не вискакував удруге. */
export function dueReminderDialog(carId: string, afterSave: boolean): Dialog {
  const rows = remindersToNotify(state.data.reminders, carId, currentOdo(carId), todayISO(), { afterSave });
  if (!rows.length) return null;
  const changed = rows.filter((r) => r.status.level > r.reminder.notified);
  if (changed.length) {
    dispatch(
      ...changed.map(
        (r): Op => ({ type: "reminder.put", data: { ...r.reminder, notified: r.status.level } }),
      ),
    );
  }
  return { type: "notify", rows };
}

function showDueReminders(carId: string): void {
  if (state.dialog) return;
  const next = dueReminderDialog(carId, false);
  if (next) openDialog(next);
}

export const markReminderDone = (reminder: Reminder): void => {
  dispatch({ type: "reminder.put", data: { ...reminder, done: true, doneDate: todayISO() } });
  toast("Отмечено как сделанное");
};

/* Демо і відновлення */

export function loadDemo(): void {
  const demo = demoRecords();
  dispatch(
    { type: "car.put", data: demo.car },
    ...demo.service.map((data): Op => ({ type: "service.put", data })),
    ...demo.fuel.map((data): Op => ({ type: "fuel.put", data })),
    { type: "demo.set", value: true },
  );
  setState({ active: demo.car.id, tab: "service" });
  saveUi();
}

export function applyBackup(raw: RawBackup): string {
  const merged = mergeBackup(state.data, raw, genId);
  const ops: Op[] = [
    ...merged.cars.map((data): Op => ({ type: "car.put", data })),
    ...merged.service.map((data): Op => ({ type: "service.put", data })),
    ...merged.fuel.map((data): Op => ({ type: "fuel.put", data })),
    ...merged.reminders.map((data): Op => ({ type: "reminder.put", data })),
  ];
  if (merged.added > 0 && state.data.demo) ops.push({ type: "demo.set", value: false });
  if (ops.length) dispatch(...ops);
  return `Загружено: добавлено ${merged.added}, уже были — ${merged.skipped}`;
}
