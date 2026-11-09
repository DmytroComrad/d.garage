import { LIMITS } from "./constants";
import { fmtDist, fmtNum } from "./format";
import { messages } from "./i18n";
import { parseOdo } from "./parse";
import { fromKm, prefs, toKm, type Unit } from "./prefs";
import type { Reminder, ReminderLevel } from "./types";

/** Пороги сповіщень у вибраних одиницях: круглі числа і для кілометрів, і для миль. */
export const DIST_THRESHOLDS: Record<Unit, { first: number; second: number }> = {
  km: { first: 1000, second: 500 },
  mi: { first: 600, second: 300 },
};
export const DAY_THRESHOLDS = { first: 30, second: 7 } as const;

/** Пресети «нагадати через» у вибраних одиницях. */
export const DIST_PRESETS: Record<Unit, number[]> = { km: [5000, 10000, 15000], mi: [3000, 5000, 10000] };

/**
 * Окреме нагадування: «через скільки» і «на якому пробігу» — два способи вказати те саме.
 * Обидва в одиницях інтерфейсу, поточний пробіг машини — у кілометрах, як у базі.
 * Повертають текст для поля; null — поле, з якого рахували, порожнє чи не число.
 */
export const odoAfter = (nowKm: number, rawAfter: string, unit: Unit = prefs().unit): string | null => {
  const after = parseOdo(rawAfter);
  return typeof after === "number" && after > 0 ? String(fromKm(nowKm, unit) + after) : null;
};

export const afterOdo = (nowKm: number, rawOdo: string, unit: Unit = prefs().unit): string | null => {
  const odo = parseOdo(rawOdo);
  const after = typeof odo === "number" ? odo - fromKm(nowKm, unit) : 0;
  return after > 0 ? String(after) : null;
};

const kmThresholds = (unit: Unit = prefs().unit) => ({
  first: toKm(DIST_THRESHOLDS[unit].first, unit),
  second: toKm(DIST_THRESHOLDS[unit].second, unit),
});

const DAY_MS = 86_400_000;

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export const addMonths = (iso: string, months: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
};

export type ReminderStatus = {
  level: ReminderLevel;
  kmLeft: number | null;
  daysLeft: number | null;
  /** "Через 480 км", "Просрочено на 120 км", "Через 3 дня", "Сегодня" — мовою інтерфейсу. */
  when: string;
};

const levelForKm = (km: number): ReminderLevel => {
  const t = kmThresholds();
  return km <= 0 ? 3 : km <= t.second ? 2 : km <= t.first ? 1 : 0;
};

const levelForDays = (days: number): ReminderLevel =>
  days <= 0 ? 3 : days <= DAY_THRESHOLDS.second ? 2 : days <= DAY_THRESHOLDS.first ? 1 : 0;

export function reminderStatus(
  rem: Pick<Reminder, "dueOdo" | "dueDate">,
  currentOdo: number | null,
  today: string,
): ReminderStatus {
  const kmLeft = rem.dueOdo != null && currentOdo != null ? rem.dueOdo - currentOdo : null;
  const daysLeft = rem.dueDate ? daysBetween(today, rem.dueDate) : null;

  const levels: ReminderLevel[] = [];
  if (kmLeft != null) levels.push(levelForKm(kmLeft));
  if (daysLeft != null) levels.push(levelForDays(daysLeft));
  const level = (levels.length ? Math.max(...levels) : 0) as ReminderLevel;

  const t = messages().reminderStatus;
  const parts: string[] = [];
  if (kmLeft != null) {
    // Округлення до миль може дати «через 0 миль»: тоді вже час.
    const left = fromKm(Math.abs(kmLeft));
    parts.push(kmLeft === 0 || left === 0 ? t.kmNow : kmLeft > 0 ? t.kmAhead(fmtDist(kmLeft)) : t.kmOver(fmtDist(-kmLeft)));
  }
  if (daysLeft != null) {
    const first = parts.length === 0;
    const n = Math.abs(daysLeft);
    parts.push(
      daysLeft > 0 ? t.daysAhead(fmtNum(n), n, first) : daysLeft === 0 ? t.today(first) : t.daysOver(fmtNum(n), n, first),
    );
  }

  return { level, kmLeft, daysLeft, when: parts.join(t.or) || t.unknown };
}

/** Текст сповіщення, напр. "Через 480 км — замена масла". */
export const reminderText = (status: ReminderStatus, title: string): string => {
  const lowered = title ? title[0].toLocaleLowerCase() + title.slice(1) : "";
  return lowered ? `${status.when} — ${lowered}` : status.when;
};

export type RemindersRow = { reminder: Reminder; status: ReminderStatus };

/**
 * Які нагадування показати у спливаючому вікні.
 * Кожен поріг (1000 км, 500 км, термін) спрацьовує один раз. Прострочене нагадує
 * знову при кожному новому записі: воно досі не виконане.
 */
export function remindersToNotify(
  reminders: Reminder[],
  carId: string,
  currentOdo: number | null,
  today: string,
  opts: { afterSave: boolean },
): RemindersRow[] {
  return reminders
    .filter((r) => r.car === carId && !r.done)
    .map((reminder) => ({ reminder, status: reminderStatus(reminder, currentOdo, today) }))
    .filter(
      ({ reminder, status }) =>
        status.level > reminder.notified || (opts.afterSave && status.level === 3),
    )
    .sort((a, b) => b.status.level - a.status.level);
}

/** Найтерміновіші зверху. */
export const sortReminders = (
  reminders: Reminder[],
  currentOdo: number | null,
  today: string,
): RemindersRow[] =>
  reminders
    .map((reminder) => ({ reminder, status: reminderStatus(reminder, currentOdo, today) }))
    .sort((a, b) => {
      if (a.status.level !== b.status.level) return b.status.level - a.status.level;
      const ka = a.status.kmLeft ?? Number.POSITIVE_INFINITY;
      const kb = b.status.kmLeft ?? Number.POSITIVE_INFINITY;
      if (ka !== kb) return ka - kb;
      return (a.status.daysLeft ?? Number.POSITIVE_INFINITY) - (b.status.daysLeft ?? Number.POSITIVE_INFINITY);
    });

/**
 * Рівень, про який вважаємо вже сказаним. Щойно створене чи змінене нагадування не вискакує
 * відразу: вікно спрацює лише на наступному порозі. Без змін строку лишається те, що було.
 */
export function notifiedLevel(
  due: Pick<Reminder, "dueOdo" | "dueDate">,
  previous: Reminder | undefined,
  currentOdo: number | null,
  today: string,
): ReminderLevel {
  const unchanged = previous && previous.dueOdo === due.dueOdo && previous.dueDate === due.dueDate;
  return unchanged ? previous.notified : reminderStatus(due, currentOdo, today).level;
}

/* Блок «Напомнить через…» у формі запису */

export type ReminderDraft = { on: boolean; title: string; km: string; date: string };

/** `km` у чернетці — відстань у вибраних одиницях, як її бачить і вводить людина. */
export const reminderDraft = (linked: Reminder | undefined, baseOdo: number | null): ReminderDraft => ({
  on: Boolean(linked),
  title: linked?.title ?? "",
  km: linked?.dueOdo != null && baseOdo != null ? String(fromKm(Math.max(0, linked.dueOdo - baseOdo))) : "",
  date: linked?.dueDate ?? "",
});

export type BuildReminderOptions = {
  car: string;
  recordId: string;
  baseOdo: number | null;
  fallbackTitle: string;
  linked?: Reminder;
  today: string;
  makeId: () => string;
};

/** null у `reminder` означає, що галочку зняли. */
export function buildReminder(
  draft: ReminderDraft,
  opts: BuildReminderOptions,
): { error: string } | { reminder: Reminder | null } {
  if (!draft.on) return { reminder: null };
  const t = messages().reminderFields;
  const parsed = parseOdo(draft.km);
  if (parsed === "invalid") return { error: t.errDigits };
  const km = parsed ? toKm(parsed) : parsed;
  const date = draft.date || null;
  if (!km && !date) return { error: t.errNeedOne };
  if (km && opts.baseOdo == null) return { error: t.errNeedOdo };
  const dueOdo = km && opts.baseOdo != null ? opts.baseOdo + km : null;
  const due = { dueOdo, dueDate: date };
  return {
    reminder: {
      id: opts.linked?.id ?? opts.makeId(),
      car: opts.car,
      title: (draft.title.trim() || opts.fallbackTitle).slice(0, LIMITS.titleLength),
      ...due,
      done: false,
      doneDate: null,
      notified: notifiedLevel(due, opts.linked, opts.baseOdo, opts.today),
      recordId: opts.recordId,
    },
  };
}
