import { useId, useState, type FormEvent } from "react";
import { LIMITS } from "../../../shared/constants";
import { fmtDist, fmtUnits, genId, todayISO, unitLabel } from "../../../shared/format";
import { parseOdo } from "../../../shared/parse";
import { fromKm, toKm } from "../../../shared/prefs";
import { DIST_PRESETS, afterOdo, notifiedLevel, odoAfter } from "../../../shared/reminders";
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
  // «Через скільки» від поточного пробігу: своє число замість пресету, пробіг рахується сам.
  const [after, setAfter] = useState(() => (now != null ? (afterOdo(now, odo) ?? "") : ""));
  const changeOdo = (value: string) => {
    setOdo(value);
    if (now != null) setAfter(afterOdo(now, value) ?? "");
  };
  const changeAfter = (value: string) => {
    setAfter(value);
    if (now == null) return;
    const target = odoAfter(now, value);
    if (target != null) setOdo(target);
    else if (!value.trim()) setOdo("");
  };
  // Інша машина — інший поточний пробіг: «через скільки» лишається, пробіг перераховується.
  const changeCar = (id: string) => {
    setCar(id);
    const nowOther = carOdo(id);
    const target = nowOther != null ? odoAfter(nowOther, after) : null;
    if (target != null) setOdo(target);
  };

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
        <CarSelect value={car} onChange={changeCar} />
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
            <input inputMode="numeric" value={odo} onChange={(e) => changeOdo(e.target.value)} />
          </Field>
          <Field label={t.reminderFields.orDate}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {now != null && (
          <div className="preset-row">
            {DIST_PRESETS[unit].map((v) => (
              <button
                key={v}
                type="button"
                className={`preset${after === String(v) ? " is-on" : ""}`}
                onClick={() => changeAfter(String(v))}
              >
                {t.reminderForm.preset(fmtUnits(v))}
              </button>
            ))}
            <label className="preset preset-input">
              <span aria-hidden="true">{t.reminderForm.customAfter}</span>
              <input
                inputMode="numeric"
                value={after}
                onChange={(e) => changeAfter(e.target.value)}
                aria-label={t.reminderForm.customLabel(unitLabel())}
                placeholder={t.reminderForm.customPlaceholder}
              />
              <span aria-hidden="true">{unitLabel()}</span>
            </label>
          </div>
        )}
        <ReminderNote />
        <FormFooter error={error} onDelete={reminder ? remove : undefined} deleteQuestion={t.reminderForm.deleteQ} />
      </form>
    </Modal>
  );
}
