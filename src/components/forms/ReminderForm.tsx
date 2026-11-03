import { useId, useState, type FormEvent } from "react";
import { LIMITS } from "../../../shared/constants";
import { fmtDist, fmtUnits, genId, todayISO, unitLabel } from "../../../shared/format";
import { parseOdo } from "../../../shared/parse";
import { fromKm, toKm } from "../../../shared/prefs";
import { DIST_PRESETS, notifiedLevel } from "../../../shared/reminders";
import type { Reminder } from "../../../shared/types";
import { closeDialog, dispatch, toast, useStore, useT } from "../../lib/store";
import { Modal } from "../Modal";
import { ReminderNote } from "../ReminderNote";
import { CarSelect, Field, FormFooter, Suggest, carOdo } from "./common";

/** Нагадування без запису: пробіг тут абсолютний, бо рахувати його нема від чого. */
export function ReminderForm({ reminder }: { reminder?: Reminder }) {
  const t = useT();
  const unit = useStore((s) => s.prefs.unit);
  const active = useStore((s) => s.active);
  const cars = useStore((s) => s.data.cars);
  const reminders = useStore((s) => s.data.reminders);
  const [car, setCar] = useState(reminder?.car ?? active ?? cars[0]?.id ?? "");
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [odo, setOdo] = useState(reminder?.dueOdo != null ? String(fromKm(reminder.dueOdo)) : "");
  const [date, setDate] = useState(reminder?.dueDate ?? "");
  const [error, setError] = useState("");
  const now = carOdo(car);
  const listId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError(t.reminderForm.errTitle);
    const parsed = parseOdo(odo);
    if (parsed === "invalid") return setError(t.serviceForm.errOdo);
    if (parsed === null && !date) return setError(t.reminderForm.errNeed);
    // Той самий пробіг без змін лишаємо як був: інакше перевід туди й назад міг би зсунути його на кілометр.
    const dueOdo = parsed === null ? null : reminder?.dueOdo != null && fromKm(reminder.dueOdo) === parsed ? reminder.dueOdo : toKm(parsed);
    const due = { dueOdo, dueDate: date || null };
    dispatch({
      type: "reminder.put",
      data: {
        id: reminder?.id ?? genId(),
        car,
        title: title.trim(),
        ...due,
        done: reminder?.done ?? false,
        doneDate: reminder?.doneDate ?? null,
        notified: notifiedLevel(due, reminder, now, todayISO()),
        recordId: reminder?.recordId ?? null,
      },
    });
    closeDialog();
    toast(t.common.saved);
  };

  const remove = () => {
    if (!reminder) return;
    dispatch({ type: "reminder.del", id: reminder.id });
    closeDialog();
    toast(t.reminderForm.deleted);
  };

  return (
    <Modal title={reminder ? t.reminderForm.titleEdit : t.reminderForm.titleNew} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <CarSelect value={car} onChange={setCar} />
        <Field label={t.reminderFields.what}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.reminderFields.placeholder}
            list={listId}
            maxLength={LIMITS.titleLength}
          />
        </Field>
        <Suggest id={listId} values={reminders.map((r) => r.title)} />
        <div className="field-row">
          <Field label={t.reminderForm.atOdo(unitLabel())} hint={now != null ? t.reminderForm.now(fmtDist(now)) : undefined}>
            <input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} />
          </Field>
          <Field label={t.reminderFields.orDate}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {now != null && (
          <div className="preset-row">
            {DIST_PRESETS[unit].map((v) => (
              <button key={v} type="button" className="preset" onClick={() => setOdo(String(fromKm(now) + v))}>
                {t.reminderForm.preset(fmtUnits(v))}
              </button>
            ))}
          </div>
        )}
        <ReminderNote />
        <FormFooter error={error} onDelete={reminder ? remove : undefined} deleteQuestion={t.reminderForm.deleteQ} />
      </form>
    </Modal>
  );
}
