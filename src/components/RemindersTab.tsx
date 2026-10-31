import { fmtDate, fmtKm } from "../../shared/format";
import { dispatch, markReminderDone, openDialog, useCarView } from "../lib/store";
import { LampIcon } from "./icons";
import { EmptyState } from "./Ledger";
import { Mono } from "./Mono";

export function RemindersTab({ carId }: { carId: string }) {
  const { activeReminders: active, doneReminders: done } = useCarView(carId);

  return (
    <div className="narrow">
      <div className="section-head">
        <p className="muted">Покажем уведомление за 1000 и за 500 км до срока, а по дате — за месяц и за неделю.</p>
        <button type="button" className="btn btn-ink" onClick={() => openDialog({ type: "reminder" })}>
          Добавить напоминание
        </button>
      </div>

      {active.length === 0 ? (
        <EmptyState
          title="Напоминаний пока нет"
          text="Поставь галочку «Напомнить через…» в любой записи или добавь напоминание здесь: замена масла, страховка, техосмотр."
        />
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
                  <span className="rec-meta">
                    <Mono text={due.join(", ")} />
                  </span>
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
                <button type="button" className="link-btn" onClick={() => dispatch({ type: "reminder.del", id: r.id })}>
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
