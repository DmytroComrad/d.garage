import { useId, useState, type FormEvent } from "react";
import { LIMITS } from "../../../shared/constants";
import { fmtKm, fmtMoney, fmtNum, genId, todayISO } from "../../../shared/format";
import { parseDecimal, parseMoney, parseOdo } from "../../../shared/parse";
import type { FuelRecord, Op } from "../../../shared/types";
import { closeDialog, dispatch, toast, useStore } from "../../lib/store";
import { Modal } from "../Modal";
import {
  CarSelect,
  Field,
  FormFooter,
  Suggest,
  finishSave,
  reminderForRecord,
  reminderOps,
  useLinkedReminder,
  usePrevOdo,
  useReminderDraft,
} from "./common";
import { PhotoField } from "./PhotoField";
import { ReminderFields } from "./ReminderFields";

export function FuelForm({ record, car: carProp }: { record?: FuelRecord; car?: string }) {
  const active = useStore((s) => s.active);
  const cars = useStore((s) => s.data.cars);
  const allFuel = useStore((s) => s.data.fuel);
  const photos = useStore((s) => s.data.photos);

  const [car, setCar] = useState(record?.car ?? carProp ?? active ?? cars[0]?.id ?? "");
  const [date, setDate] = useState(record?.date ?? todayISO());
  const [odo, setOdo] = useState(record ? String(record.odo) : "");
  const [liters, setLiters] = useState(record ? String(record.liters).replace(".", ",") : "");
  const [sum, setSum] = useState(record ? String(record.sum).replace(".", ",") : "");
  const [station, setStation] = useState(record?.station ?? "");
  const [full, setFull] = useState(record?.full ?? true);
  const [note, setNote] = useState(record?.note ?? "");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const prev = usePrevOdo(car, record?.id);
  const linked = useLinkedReminder(record?.id);
  const [reminder, setReminder] = useReminderDraft(linked, record?.odo ?? null);

  const stationsId = useId();
  const parsedOdo = parseOdo(odo);
  const baseOdo = typeof parsedOdo === "number" ? parsedOdo : null;
  const parsedLiters = parseDecimal(liters);
  const parsedSum = parseMoney(sum);
  const price =
    typeof parsedLiters === "number" && parsedLiters > 0 && typeof parsedSum === "number" && parsedSum > 0
      ? parsedSum / parsedLiters
      : null;
  const existing = record ? photos.filter((p) => p.recordId === record.id) : [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!date) return setError("Укажи дату.");
    if (parsedOdo === "invalid") return setError("Пробег — только цифры.");
    if (parsedOdo === null) return setError("Для заправки нужен пробег — без него не посчитать расход.");
    if (typeof parsedLiters !== "number" || parsedLiters <= 0 || parsedLiters > LIMITS.maxLiters) {
      return setError("Укажи литры.");
    }
    if (typeof parsedSum !== "number" || parsedSum <= 0 || parsedSum > LIMITS.maxSum) {
      return setError("Укажи сумму с чека.");
    }

    const id = record?.id ?? genId();
    const built = reminderForRecord(reminder, {
      car,
      recordId: id,
      baseOdo: parsedOdo,
      fallbackTitle: "Обслуживание",
      linked,
    });
    if ("error" in built) return setError(built.error);

    const next: FuelRecord = {
      id,
      car,
      date,
      odo: parsedOdo,
      liters: parsedLiters,
      sum: parsedSum,
      station: station.trim(),
      full,
      note: note.trim(),
    };
    dispatch({ type: "fuel.put", data: next }, ...reminderOps(built.reminder, linked));
    finishSave(car, !record, files, id);
  };

  const remove = () => {
    if (!record) return;
    const ops: Op[] = [{ type: "fuel.del", id: record.id }];
    if (linked) ops.push({ type: "reminder.del", id: linked.id });
    dispatch(...ops);
    closeDialog();
    toast("Запись удалена");
  };

  return (
    <Modal title={record ? "Заправка" : "Новая заправка"} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <CarSelect value={car} onChange={setCar} />
        <div className="field-row">
          <Field label="Дата">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Пробег, км" hint={prev != null ? `Прошлый: ${fmtKm(prev)}` : undefined}>
            <input
              inputMode="numeric"
              value={odo}
              onChange={(e) => setOdo(e.target.value)}
              placeholder={prev != null ? fmtNum(prev) : ""}
            />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Литры">
            <input inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} />
          </Field>
          <Field label="Сумма ₴" hint={price != null ? `≈ ${fmtMoney(price)}/л` : undefined}>
            <input inputMode="decimal" value={sum} onChange={(e) => setSum(e.target.value)} />
          </Field>
        </div>
        <Field label="АЗС">
          <input
            value={station}
            onChange={(e) => setStation(e.target.value)}
            list={stationsId}
            maxLength={LIMITS.placeLength}
          />
        </Field>
        <Suggest id={stationsId} values={allFuel.map((f) => f.station)} />
        <label className="check">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
          <span>
            Полный бак <span className="muted">— нужно для точного расхода</span>
          </span>
        </label>
        <Field label="Заметка">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.noteLength} />
        </Field>
        <ReminderFields draft={reminder} onChange={setReminder} baseOdo={baseOdo} baseDate={date} />
        <PhotoField existing={existing} pending={files} onPending={setFiles} />
        <FormFooter error={error} onDelete={record ? remove : undefined} />
      </form>
    </Modal>
  );
}
