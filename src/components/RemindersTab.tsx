import { fmtDate, fmtDist, fmtNum, fmtUnits } from "../../shared/format";
import { DIST_THRESHOLDS } from "../../shared/reminders";
import { dispatch, markReminderDone, openDialog, useCarView, useStore, useT } from "../lib/store";
import { LampIcon } from "./icons";
import { EmptyState } from "./Ledger";
import { Mono } from "./Mono";
import { ReminderNote } from "./ReminderNote";

export function RemindersTab({ carId }: { carId: string }) {
  const t = useT();
  const unit = useStore((s) => s.prefs.unit);
  const { activeReminders: active, doneReminders: done } = useCarView(carId);
  const limits = DIST_THRESHOLDS[unit];

  return (
    <div className="narrow">
      <div className="section-head">
        <p className="muted">{t.reminders.hint(fmtNum(limits.first), fmtUnits(limits.second))}</p>
        <button type="button" className="btn btn-ink" onClick={() => openDialog({ type: "reminder" })}>
          {t.reminders.add}
        </button>
      </div>
      <div className="note-slot">
        <ReminderNote />
      </div>

      {active.length === 0 ? (
        <EmptyState title={t.reminders.emptyTitle} text={t.reminders.emptyText} />
      ) : (
        <div className="sheet ledger">
          {active.map(({ reminder, status }) => {
            const due = [
              reminder.dueOdo != null ? t.reminders.dueOdo(fmtDist(reminder.dueOdo)) : "",
              reminder.dueDate ? t.reminders.dueDate(fmtDate(reminder.dueDate)) : "",
            ].filter(Boolean);
            return (
              <article key={reminder.id} className={`rem rem-${status.level}`}>
                <span className="lamp-icon">
                  <LampIcon />
                </span>
                <button type="button" className="rem-main" onClick={() => openDialog({ type: "reminder", reminder })}>
                  <span className="rec-title">{reminder.title || t.reminders.defaultTitle}</span>
                  <span className="rem-when">{status.when}</span>
                  <span className="rec-meta">
                    <Mono text={due.join(", ")} />
                  </span>
                </button>
                <button type="button" className="btn btn-small btn-quiet" onClick={() => markReminderDone(reminder)}>
                  {t.reminders.done}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <details className="done-list">
          <summary>{t.reminders.doneCount(done.length)}</summary>
          <ul>
            {done.map((r) => (
              <li key={r.id}>
                <span>
                  {r.title || t.reminders.defaultTitle} <span className="muted">{fmtDate(r.doneDate)}</span>
                </span>
                <button type="button" className="link-btn" onClick={() => dispatch({ type: "reminder.del", id: r.id })}>
                  {t.common.delete}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
