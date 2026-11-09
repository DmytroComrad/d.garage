import { useSyncExternalStore } from "react";
import { mergeBackup, type RawBackup } from "../../shared/backup";
import { demoRecords } from "../../shared/demo";
import { genId, todayISO } from "../../shared/format";
import { MESSAGES, messages, type Messages } from "../../shared/i18n";
import { applyOp, emptyData } from "../../shared/ops";
import { applyPrefs, readPrefs, type Prefs } from "../../shared/prefs";
import { remindersToNotify, type RemindersRow } from "../../shared/reminders";
import type {
  AppConfig,
  DriveStatus,
  FuelRecord,
  GarageData,
  Manual,
  Op,
  OpsResponse,
  Photo,
  Reminder,
  ServiceRecord,
  StateResponse,
  User,
  Wish,
} from "../../shared/types";
import { HttpError, NetworkError, getIfChanged, getJson, postJson } from "./api";
import { createCache } from "./cache";
import { drainQueue, reconcileQueue } from "./sync";
import { carView, type CarView } from "./view";

export type Tab = "service" | "fuel" | "reminders" | "wishes" | "manuals" | "gallery" | "stats" | "data";
export type Theme = "auto" | "light" | "dark";

/** Що підставити в нову сервісну форму: так хотілка стає записом витрат. */
export type ServiceDraft = { what: string; sum: number | null; note: string };

export type Dialog =
  | { type: "fuel"; record?: FuelRecord; car?: string }
  | { type: "service"; record?: ServiceRecord; car?: string; draft?: ServiceDraft; wishId?: string }
  | { type: "car" }
  | { type: "reminder"; reminder?: Reminder }
  | { type: "wish"; wish?: Wish }
  | { type: "wishDone"; wish: Wish }
  | { type: "notify"; rows: RemindersRow[] }
  | { type: "account" }
  | { type: "copy"; text: string }
  | { type: "lightbox"; photos: Photo[]; index: number }
  | { type: "manual"; manual?: Manual; car?: string }
  | { type: "manualShare"; car: string }
  | { type: "sharedManuals"; token: string }
  | null;

export type AppState = {
  phase: "loading" | "anon" | "ready";
  resetToken: string | null;
  config: AppConfig;
  user: User | null;
  data: GarageData;
  drive: DriveStatus;
  etag: string | null;
  active: string | null;
  tab: Tab;
  theme: Theme;
  prefs: Prefs;
  /** Пояснення, як працюють нагадування, вже прочитали на цьому пристрої. */
  reminderNoteSeen: boolean;
  queue: Op[];
  offline: boolean;
  storageOk: boolean;
  dialog: Dialog;
  toast: { id: number; text: string } | null;
  uploading: number;
};

const UI_KEY = "garage-ui";
const TABS: Tab[] = ["service", "fuel", "reminders", "wishes", "manuals", "gallery", "stats", "data"];

const noDrive: DriveStatus = { connected: false, email: null, sheetUrl: null, sheetExportedAt: null };

type StoredUi = {
  tab?: Tab;
  active?: string;
  theme?: Theme;
  lang?: unknown;
  unit?: unknown;
  dateFormat?: unknown;
  reminderNoteSeen?: boolean;
};

const readUi = (): StoredUi => {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) ?? "{}");
  } catch {
    return {};
  }
};

const ui = readUi();
const initialPrefs = readPrefs(ui);
// Форматування читає налаштування з shared/prefs: ставимо їх ще до першого малювання.
applyPrefs(initialPrefs);

let state: AppState = {
  phase: "loading",
  resetToken: null,
  config: { googleLogin: false, drive: false, passwordReset: false, turnstileSiteKey: null },
  user: null,
  data: emptyData(),
  drive: noDrive,
  etag: null,
  active: ui.active ?? null,
  tab: ui.tab && TABS.includes(ui.tab) ? ui.tab : "service",
  theme: ui.theme ?? "auto",
  prefs: initialPrefs,
  reminderNoteSeen: ui.reminderNoteSeen === true,
  queue: [],
  offline: false,
  storageOk: true,
  dialog: null,
  toast: null,
  uploading: 0,
};

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const setState = (patch: Partial<AppState>): void => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const getState = (): AppState => state;

/**
 * Підписка на частину стану: компонент оновиться лише тоді, коли вона зміниться, тож тост
 * не перемальовує весь журнал. Селектор має повертати значення зі стану або примітив, а не новий об'єкт.
 */
export const useStore = <T>(selector: (s: AppState) => T): T => useSyncExternalStore(subscribe, () => selector(state));

/**
 * Тексти поточної мови. Компонент підписується на всі налаштування, тож перемальовується
 * і при зміні одиниць чи формату дати: числа й дати форматуються тими ж налаштуваннями.
 */
export const useT = (): Messages => MESSAGES[useStore((s) => s.prefs).lang];

export const useCarView = (carId: string): CarView => {
  const data = useStore((s) => s.data);
  const prefs = useStore((s) => s.prefs);
  return carView(data, carId, todayISO(), prefs);
};

const cache = createCache(() => localStorage);

const saveUi = (): void => {
  try {
    const stored: StoredUi = {
      tab: state.tab,
      active: state.active ?? undefined,
      theme: state.theme,
      ...state.prefs,
      reminderNoteSeen: state.reminderNoteSeen,
    };
    localStorage.setItem(UI_KEY, JSON.stringify(stored));
  } catch {
    // Вибір вкладки не вартий банера.
  }
};

const saveCache = (): void => {
  if (!state.user) return;
  const ok = cache.write({
    user: state.user,
    data: state.data,
    drive: state.drive,
    queue: state.queue,
    etag: state.etag,
  });
  // Черга без мережі живе лише в пам'яті: про це треба сказати.
  if (ok !== state.storageOk) setState({ storageOk: ok });
};

const ensureActive = (): void => {
  const { cars } = state.data;
  if (!cars.some((c) => c.id === state.active)) {
    setState({ active: cars[0]?.id ?? null });
    saveUi();
  }
};

const signedOut = (): Partial<AppState> => ({
  phase: "anon",
  user: null,
  data: emptyData(),
  drive: noDrive,
  etag: null,
  queue: [],
  dialog: null,
});

/** Сесія закінчилась: дані з пристрою прибираємо, а незбережені зміни лишаємо до повторного входу. */
const endSession = (): void => {
  if (state.user && state.queue.length) cache.writePending({ userId: state.user.id, queue: state.queue });
  cache.clear();
  setState(signedOut());
};

/** Користувач вийшов сам: на пристрої не лишається нічого. */
export const resetToAnon = (): void => {
  cache.clear();
  cache.clearPending();
  if (history.state?.dialog) history.back();
  setState({ ...signedOut(), active: null });
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastSeq = 0;

export const toast = (text: string): void => {
  clearTimeout(toastTimer);
  setState({ toast: { id: ++toastSeq, text } });
  toastTimer = setTimeout(() => setState({ toast: null }), 2600);
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

declare global {
  interface Window {
    garageApplyTheme?: () => void;
  }
}

export const setTheme = (theme: Theme): void => {
  setState({ theme });
  saveUi();
  // Логіка теми живе в public/theme.js: вона виконується ще до першого малювання.
  window.garageApplyTheme?.();
};

/** Мова сторінки для читалок екрана, перекладача браузера й заголовка вкладки. */
const applyDocumentLang = (): void => {
  const t = messages();
  document.documentElement.lang = state.prefs.lang;
  document.title = t.meta.title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", t.meta.description);
};

export const setPrefs = (patch: Partial<Prefs>): void => {
  const prefs = { ...state.prefs, ...patch };
  applyPrefs(prefs);
  setState({ prefs });
  saveUi();
  applyDocumentLang();
};

export const dismissReminderNote = (): void => {
  setState({ reminderNoteSeen: true });
  saveUi();
};

/** Посилання на вхід через Google: мова потрібна, щоб Google і папки на Диску говорили нею ж. */
export const googleHref = (path: "/api/google/login" | "/api/google/drive/connect"): string =>
  `${path}?lang=${state.prefs.lang}`;

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

/* Синхронізація: зміна одразу видна в інтерфейсі, а на сервер іде через чергу. */

let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 3000;

const scheduleRetry = (): void => {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void flush(), retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60_000);
};

/** Машини, які сервер об'єднав із наявними: нове фото може ще посилатись на старий id. */
const carAliases = new Map<string, string>();
export const resolveCarId = (id: string): string => carAliases.get(id) ?? id;

export async function flush(): Promise<void> {
  if (flushing || !state.user) return;
  flushing = true;
  let result;
  try {
    result = await drainQueue({
      queue: () => state.queue,
      setQueue: (queue) => {
        setState({ queue });
        saveCache();
      },
      send: (ops) => postJson<OpsResponse>("/api/ops", { ops }),
      onRemap: (aliases) => {
        for (const [from, to] of aliases) carAliases.set(from, to);
        const moved = state.active ? aliases.get(state.active) : undefined;
        if (moved) {
          setState({ active: moved });
          saveUi();
        }
      },
      notify: toast,
    });
  } finally {
    flushing = false;
  }

  if (result.outcome === "unauthorized") return endSession();
  if (result.outcome === "retry") {
    setState({ offline: true });
    scheduleRetry();
    return;
  }
  retryDelay = 3000;
  setState({ offline: false });
  if (result.stale) await refresh({ force: true });
}

export function dispatch(...ops: Op[]): void {
  let data = state.data;
  for (const op of ops) data = applyOp(data, op);
  setState({ data, queue: [...state.queue, ...ops] });
  ensureActive();
  saveCache();
  void flush();
}

/** Кеш зі старої версії застосунку міг не мати нових списків. */
const withDefaults = (data: GarageData): GarageData => ({ ...emptyData(), ...data, wishes: data.wishes ?? [] });

export async function refresh({ force = false } = {}): Promise<void> {
  try {
    const res = await getIfChanged<StateResponse>("/api/state", force ? null : state.etag);
    if (!res.changed) {
      setState({ offline: false });
      return;
    }
    const { user, data: server, drive } = res.body;
    const pending = cache.readPending();
    const queue = reconcileQueue({ localUserId: state.user?.id ?? null, serverUserId: user.id, queue: state.queue, pending });
    if (pending) cache.clearPending();
    // Операції, які ще не дійшли до сервера, накладаємо поверх свіжих даних.
    let data = withDefaults(server);
    for (const op of queue) data = applyOp(data, op);
    setState({ user, data, drive, queue, etag: res.etag, phase: "ready", offline: false });
    ensureActive();
    saveCache();
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) return endSession();
    if (err instanceof NetworkError || (err instanceof HttpError && err.status >= 500)) {
      setState({ offline: true });
    }
  }
}

const REDIRECT_MESSAGES: Record<string, keyof Messages["redirect"]> = {
  "drive=connected": "driveConnected",
  "drive=denied": "driveDenied",
  "drive=scope": "driveScope",
  "drive=error": "driveError",
  "google=denied": "googleDenied",
  "google=error": "googleError",
  "google=state": "googleState",
  "google=unverified": "googleUnverified",
  "google=linked": "googleLinked",
  "google=taken": "googleTaken",
  "google=claimed": "googleClaimed",
};

const SHARED_MANUALS_KEY = "garage-shared-manuals";
let pendingSharedManuals: string | null = null;

/** Якщо людина прийшла за посиланням на мануали, після входу показуємо їх. Повертає, чи відкрито вікно. */
const openSharedManuals = (): boolean => {
  let token = pendingSharedManuals;
  try {
    token = sessionStorage.getItem(SHARED_MANUALS_KEY) ?? token;
    sessionStorage.removeItem(SHARED_MANUALS_KEY);
  } catch {
    // Без sessionStorage лишається змінна в пам'яті.
  }
  pendingSharedManuals = null;
  if (!token || !state.user) return false;
  openDialog({ type: "sharedManuals", token });
  return true;
};

const consumeUrlParams = (): void => {
  const url = new URL(location.href);
  let message: string | undefined;
  for (const key of ["drive", "google"]) {
    const value = url.searchParams.get(key);
    if (value) {
      const known = REDIRECT_MESSAGES[`${key}=${value}`];
      if (known) message = messages().redirect[known];
      url.searchParams.delete(key);
      if (key === "drive") setState({ tab: "data" });
    }
  }
  // Чужі мануали за посиланням: запам'ятовуємо до входу, якщо людина ще не увійшла.
  const shared = url.searchParams.get("manuals");
  if (shared) {
    try {
      sessionStorage.setItem(SHARED_MANUALS_KEY, shared);
    } catch {
      pendingSharedManuals = shared;
    }
    url.searchParams.delete("manuals");
  }
  const reset = url.searchParams.get("reset");
  if (reset) {
    setState({ resetToken: reset });
    url.searchParams.delete("reset");
  }
  if (url.search !== location.search) history.replaceState(null, "", url.pathname + url.search);
  if (message) toast(message);
};

export const clearResetToken = (): void => setState({ resetToken: null });

export async function boot(): Promise<void> {
  applyDocumentLang();
  window.addEventListener("popstate", () => {
    if (state.dialog) setState({ dialog: null });
  });
  consumeUrlParams();
  void getJson<AppConfig>("/api/config")
    .then((config) => setState({ config }))
    .catch(() => undefined);

  const cached = cache.read();
  if (cached) {
    setState({ ...cached, data: withDefaults(cached.data), phase: "ready" });
    ensureActive();
  }

  await refresh();
  if (state.phase === "loading") setState({ phase: state.user ? "ready" : "anon" });
  if (state.user) {
    await flush();
    if (!openSharedManuals() && state.active) showDueReminders(state.active);
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

/** Після входу: забрати дані й дописати те, що чекало в черзі. Кидає помилку, якщо сервер недоступний. */
export async function afterAuth(): Promise<void> {
  await refresh({ force: true });
  if (state.phase !== "ready") throw new NetworkError(messages().common.noServer);
  await flush();
  if (!openSharedManuals() && state.active) showDueReminders(state.active);
}

/**
 * Вихід лише після відповіді сервера: cookie сесії недоступна з JavaScript, тож без неї
 * акаунт відкрився б знову. Незбережені записи теж не можна просто стерти.
 */
export async function logout(everywhere = false): Promise<void> {
  await flush();
  if (state.queue.length) {
    toast(messages().session.logoutPending);
    return;
  }
  try {
    await postJson(everywhere ? "/api/auth/logout-all" : "/api/auth/logout");
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 401)) {
      toast(messages().session.logoutOffline);
      return;
    }
  }
  resetToAnon();
}

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

/** Мануали, які створив сервер: завантажений файл чи копії з чужого посилання. */
export const addManuals = (manuals: Manual[]): void => {
  const ids = new Set(manuals.map((m) => m.id));
  setState({ data: { ...state.data, manuals: [...state.data.manuals.filter((m) => !ids.has(m.id)), ...manuals] } });
  saveCache();
};

export const removePhoto = (id: string): void => {
  setState({ data: { ...state.data, photos: state.data.photos.filter((p) => p.id !== id) } });
  saveCache();
};

export const setUploading = (delta: number): void => setState({ uploading: Math.max(0, state.uploading + delta) });

export const currentOdo = (carId: string): number | null =>
  carView(state.data, carId, todayISO(), state.prefs).summary.currentOdo;

/** Запам'ятовує показане вікно, щоб той самий поріг не вискакував удруге. */
export function dueReminderDialog(carId: string, afterSave: boolean): Dialog {
  const rows = remindersToNotify(state.data.reminders, carId, currentOdo(carId), todayISO(), { afterSave });
  if (!rows.length) return null;
  const changed = rows.filter((r) => r.status.level > r.reminder.notified);
  if (changed.length) {
    dispatch(
      ...changed.map((r): Op => ({ type: "reminder.put", data: { ...r.reminder, notified: r.status.level } })),
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
  toast(messages().reminders.markedDone);
};

/* Видалення записів */

/** Записи разом з їхніми ще не виконаними нагадуваннями — так само, як кнопка «Удалить» у формі. */
export function deleteRecordsOps(kind: "service" | "fuel", ids: string[]): Op[] {
  const set = new Set(ids);
  const ops: Op[] = ids.map((id): Op => (kind === "service" ? { type: "service.del", id } : { type: "fuel.del", id }));
  for (const r of state.data.reminders) {
    if (r.recordId && set.has(r.recordId) && !r.done) ops.push({ type: "reminder.del", id: r.id });
  }
  return ops;
}

export function deleteRecords(kind: "service" | "fuel", ids: string[]): void {
  if (!ids.length) return;
  dispatch(...deleteRecordsOps(kind, ids));
}

/* Хотілки */

/**
 * Галочка «виконано». Якщо в хотілки вже є живий запис витрат, він просто знову рахується.
 * Якщо немає — пропонуємо його створити. Знята галочка лишає зв'язок: запис стає «неактуальним».
 */
export function setWishDone(wish: Wish, done: boolean): void {
  const t = messages().wishes;
  const hasRecord = wish.recordId != null && state.data.service.some((r) => r.id === wish.recordId);
  const next: Wish = { ...wish, done, doneDate: done ? todayISO() : null };
  dispatch({ type: "wish.put", data: next });
  if (!done) return toast(hasRecord ? t.toastUndoneLinked : t.toastUndone);
  if (hasRecord) return toast(t.toastRedone);
  openDialog({ type: "wishDone", wish: next });
}

/** Залишити «неактуальні» записи: прибрати їхній зв'язок із хотілками. */
export function unlinkWishes(wishes: Wish[]): void {
  if (!wishes.length) return;
  dispatch(...wishes.map((w): Op => ({ type: "wish.put", data: { ...w, recordId: null } })));
}

/* Демо і відновлення */

export function loadDemo(): void {
  const demo = demoRecords(todayISO());
  dispatch(
    { type: "car.put", data: demo.car },
    ...demo.service.map((data): Op => ({ type: "service.put", data })),
    ...demo.fuel.map((data): Op => ({ type: "fuel.put", data })),
    ...demo.wishes.map((data): Op => ({ type: "wish.put", data })),
    { type: "demo.set", value: true },
  );
  setState({ active: demo.car.id, tab: "service" });
  saveUi();
}

export function applyBackup(raw: RawBackup): { added: number; skipped: number } {
  const merged = mergeBackup(state.data, raw, genId, todayISO());
  const ops: Op[] = [
    ...merged.cars.map((data): Op => ({ type: "car.put", data })),
    ...merged.service.map((data): Op => ({ type: "service.put", data })),
    ...merged.fuel.map((data): Op => ({ type: "fuel.put", data })),
    ...merged.reminders.map((data): Op => ({ type: "reminder.put", data })),
    ...merged.wishes.map((data): Op => ({ type: "wish.put", data })),
  ];
  if (merged.added > 0 && state.data.demo) ops.push({ type: "demo.set", value: false });
  if (ops.length) dispatch(...ops);
  return { added: merged.added, skipped: merged.skipped };
}
