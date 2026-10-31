import { carSummary } from "../../shared/calc";
import { fmtDate, fmtKm, todayISO } from "../../shared/format";
import { sortReminders } from "../../shared/reminders";
import { carRecords, dispatch, markReminderDone, openDialog, useApp } from "../lib/store";
import { LampIcon } from "./icons";
import { Mono } from "./Mono";

export function RemindersTab({ carId }: { carId: string }) {
  const { data } = useApp();
  const { service, fuel, reminders } = carRecords(data, carId);
  const today = todayISO();
  const odo = carSummary(service, fuel, today).currentOdo;
  const active = sortReminders(reminders.filter((r) => !r.done), odo, today);
  const done = reminders.filter((r) => r.done).sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? ""));

  return (
    <div className="narrow">
      <div className="section-head">
        <p className="muted">Покажем уведомление за 1000 и за 500 км до срока, а по дате — за месяц и за неделю.</p>
        <button type="button" className="btn btn-ink" onClick={() => openDialog({ type: "reminder" })}>
          Добавить напоминание
        </button>
      </div>

      {active.length === 0 ? (
        <div className="empty">
          <h2>Напоминаний пока нет</h2>
          <p>
            Поставь галочку «Напомнить через…» в любой записи или добавь напоминание здесь: замена масла, страховка,
            техосмотр.
          </p>
        </div>
      ) : (
        <div className="sheet ledger">
          {active.map(({ reminder, status }) => {
            const due = [
              reminder.dueOdo != null ? `на пробеге ${fmtKm(reminder.dueOdo)}` : "",
              reminder.dueDate ? `к ${fmtDate(reminder.dueDate)}` : "",
            ].filter(Boolean);
            return (
              <article key={reminder.id} className={`rem rem-${status.level}`}>
                <span className="lamp-icon">
                  <LampIcon />
                </span>
                <button type="button" className="rem-main" onClick={() => openDialog({ type: "reminder", reminder })}>
                  <span className="rec-title">{reminder.title || "Обслуживание"}</span>
                  <span className="rem-when">{status.when}</span>
                  <span className="rec-meta"><Mono text={due.join(", ")} /></span>
                </button>
                <button type="button" className="btn btn-small btn-quiet" onClick={() => markReminderDone(reminder)}>
                  Сделано
                </button>
              </article>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <details className="done-list">
          <summary>Сделано: {done.length}</summary>
          <ul>
            {done.map((r) => (
              <li key={r.id}>
                <span>
                  {r.title || "Обслуживание"} <span className="muted">{fmtDate(r.doneDate)}</span>
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => dispatch({ type: "reminder.del", id: r.id })}
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
