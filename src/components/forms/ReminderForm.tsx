import { useId, useState, type FormEvent } from "react";
import { LIMITS } from "../../../shared/constants";
import { fmtKm, fmtNum, genId, todayISO } from "../../../shared/format";
import { parseOdo } from "../../../shared/parse";
import { notifiedLevel } from "../../../shared/reminders";
import type { Reminder } from "../../../shared/types";
import { closeDialog, dispatch, toast, useStore } from "../../lib/store";
import { Modal } from "../Modal";
import { CarSelect, Field, FormFooter, Suggest, carOdo } from "./common";
import { KM_PRESETS } from "./ReminderFields";

/** Нагадування без запису: пробіг тут абсолютний, бо рахувати його нема від чого. */
export function ReminderForm({ reminder }: { reminder?: Reminder }) {
  const active = useStore((s) => s.active);
  const cars = useStore((s) => s.data.cars);
  const reminders = useStore((s) => s.data.reminders);
  const [car, setCar] = useState(reminder?.car ?? active ?? cars[0]?.id ?? "");
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [odo, setOdo] = useState(reminder?.dueOdo != null ? String(reminder.dueOdo) : "");
  const [date, setDate] = useState(reminder?.dueDate ?? "");
  const [error, setError] = useState("");
  const now = carOdo(car);
  const listId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError("Напиши, что нужно сделать.");
    const dueOdo = parseOdo(odo);
    if (dueOdo === "invalid") return setError("Пробег — только цифры.");
    if (dueOdo === null && !date) return setError("Укажи пробег или дату.");
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
    toast("Сохранено");
  };

  const remove = () => {
    if (!reminder) return;
    dispatch({ type: "reminder.del", id: reminder.id });
    closeDialog();
    toast("Напоминание удалено");
  };

  return (
    <Modal title={reminder ? "Напоминание" : "Новое напоминание"} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <CarSelect value={car} onChange={setCar} />
        <Field label="Что нужно сделать или заменить">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: замена масла"
            list={listId}
            maxLength={LIMITS.titleLength}
          />
        </Field>
        <Suggest id={listId} values={reminders.map((r) => r.title)} />
        <div className="field-row">
          <Field label="На пробеге, км" hint={now != null ? `Сейчас: ${fmtKm(now)}` : undefined}>
            <input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} />
          </Field>
          <Field label="Или к дате">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {now != null && (
          <div className="preset-row">
            {KM_PRESETS.map((v) => (
              <button key={v} type="button" className="preset" onClick={() => setOdo(String(now + v))}>
                через {fmtNum(v)} км
              </button>
            ))}
          </div>
        )}
        <FormFooter error={error} onDelete={reminder ? remove : undefined} deleteQuestion="Удалить?" />
      </form>
    </Modal>
  );
}
