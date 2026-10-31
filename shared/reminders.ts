import { LIMITS } from "./constants";
import { fmtNum, plural } from "./format";
import { parseOdo } from "./parse";
import type { Reminder, ReminderLevel } from "./types";

export const KM_THRESHOLDS = { first: 1000, second: 500 } as const;
export const DAY_THRESHOLDS = { first: 30, second: 7 } as const;

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
  /** "Через 480 км", "Просрочено на 120 км", "Через 3 дня", "Сегодня". */
  when: string;
};

const levelForKm = (km: number): ReminderLevel =>
  km <= 0 ? 3 : km <= KM_THRESHOLDS.second ? 2 : km <= KM_THRESHOLDS.first ? 1 : 0;

const levelForDays = (days: number): ReminderLevel =>
  days <= 0 ? 3 : days <= DAY_THRESHOLDS.second ? 2 : days <= DAY_THRESHOLDS.first ? 1 : 0;

const dayWord = (n: number): string => `${fmtNum(n)} ${plural(n, ["день", "дня", "дней"])}`;

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

  const parts: string[] = [];
  if (kmLeft != null) {
    parts.push(
      kmLeft > 0
        ? `Через ${fmtNum(kmLeft)} км`
        : kmLeft === 0
          ? "Пора по пробегу"
          : `Просрочено на ${fmtNum(-kmLeft)} км`,
    );
  }
  if (daysLeft != null) {
    const first = parts.length === 0;
    parts.push(
      daysLeft > 0
        ? `${first ? "Через" : "через"} ${dayWord(daysLeft)}`
        : daysLeft === 0
          ? first
            ? "Сегодня"
            : "сегодня"
          : `${first ? "Просрочено" : "просрочено"} на ${dayWord(-daysLeft)}`,
    );
  }

  return { level, kmLeft, daysLeft, when: parts.join(" или ") || "Срок пока не посчитать" };
}

/** Текст сповіщення, напр. "Через 480 км — замена масла". */
export const reminderText = (status: ReminderStatus, title: string): string => {
  const lowered = title ? title[0].toLocaleLowerCase("ru-RU") + title.slice(1) : "";
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

export const reminderDraft = (linked: Reminder | undefined, baseOdo: number | null): ReminderDraft => ({
  on: Boolean(linked),
  title: linked?.title ?? "",
  km: linked?.dueOdo != null && baseOdo != null ? String(Math.max(0, linked.dueOdo - baseOdo)) : "",
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
  const km = parseOdo(draft.km);
  if (km === "invalid") return { error: "В напоминании километры — только цифры." };
  const date = draft.date || null;
  if (!km && !date) return { error: "Укажи, через сколько километров или к какой дате напомнить." };
  if (km && opts.baseOdo == null) return { error: "Чтобы считать километры, укажи пробег этой записи." };
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
