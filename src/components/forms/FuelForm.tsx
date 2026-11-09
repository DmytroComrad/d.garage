import { useId, useState, type FormEvent } from "react";
import { LIMITS } from "../../../shared/constants";
import { fmtDist, fmtMoney, fmtNum, genId, numInput, todayISO, unitLabel } from "../../../shared/format";
import { FUEL_GROUPS, groupsForFuelType, isFuelGrade, lastGrade, type FuelGrade } from "../../../shared/fuelGrades";
import { parseDecimal, parseMoney, parseOdo } from "../../../shared/parse";
import { fromKm, toKm } from "../../../shared/prefs";
import type { FuelRecord } from "../../../shared/types";
import { closeDialog, deleteRecordsOps, dispatch, toast, useStore, useT } from "../../lib/store";
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
  const t = useT();
  const active = useStore((s) => s.active);
  const cars = useStore((s) => s.data.cars);
  const allFuel = useStore((s) => s.data.fuel);
  const photos = useStore((s) => s.data.photos);

  const [car, setCar] = useState(record?.car ?? carProp ?? active ?? cars[0]?.id ?? "");
  const fuelType = useStore((s) => (s.data.cars.find((c) => c.id === car) as { fuelType?: string | null } | undefined)?.fuelType);
  const [date, setDate] = useState(record?.date ?? todayISO());
  const [odo, setOdo] = useState(record ? String(fromKm(record.odo)) : "");
  const [liters, setLiters] = useState(record ? numInput(record.liters) : "");
  const [sum, setSum] = useState(record ? numInput(record.sum) : "");
  const [station, setStation] = useState(record?.station ?? "");
  // Нова заправка пропонує ту саму марку, що й минулого разу.
  const [grade, setGrade] = useState<FuelGrade | "">(record ? (record.grade ?? "") : (lastGrade(allFuel, car) ?? ""));
  const [full, setFull] = useState(record?.full ?? true);
  const [note, setNote] = useState(record?.note ?? "");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const prev = usePrevOdo(car, record?.id);
  const linked = useLinkedReminder(record?.id);
  const [reminder, setReminder] = useReminderDraft(linked, record?.odo ?? null);

  const stationsId = useId();
  const parsedOdo = parseOdo(odo);
  const baseOdo = typeof parsedOdo === "number" ? toKm(parsedOdo) : null;
  const parsedLiters = parseDecimal(liters);
  const parsedSum = parseMoney(sum);
  const price =
    typeof parsedLiters === "number" && parsedLiters > 0 && typeof parsedSum === "number" && parsedSum > 0
      ? parsedSum / parsedLiters
      : null;
  const existing = record ? photos.filter((p) => p.recordId === record.id) : [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!date) return setError(t.serviceForm.errDate);
    if (parsedOdo === "invalid") return setError(t.serviceForm.errOdo);
    if (parsedOdo === null || baseOdo === null) return setError(t.fuelForm.errOdoRequired);
    if (typeof parsedLiters !== "number" || parsedLiters <= 0 || parsedLiters > LIMITS.maxLiters) {
      return setError(t.fuelForm.errLiters);
    }
    if (typeof parsedSum !== "number" || parsedSum <= 0 || parsedSum > LIMITS.maxSum) {
      return setError(t.fuelForm.errSum);
    }

    const id = record?.id ?? genId();
    const built = reminderForRecord(reminder, {
      car,
      recordId: id,
      baseOdo,
      fallbackTitle: t.reminders.defaultTitle,
      linked,
    });
    if ("error" in built) return setError(built.error);

    const next: FuelRecord = {
      id,
      car,
      date,
      odo: baseOdo,
      liters: parsedLiters,
      sum: parsedSum,
      station: station.trim(),
      full,
      note: note.trim(),
      grade: grade || null,
    };
    dispatch({ type: "fuel.put", data: next }, ...reminderOps(built.reminder, linked));
    finishSave(car, !record, files, id);
  };

  const remove = () => {
    if (!record) return;
    dispatch(...deleteRecordsOps("fuel", [record.id]));
    closeDialog();
    toast(t.common.recordDeleted);
  };

  return (
    <Modal title={record ? t.fuelForm.titleEdit : t.fuelForm.titleNew} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <CarSelect value={car} onChange={setCar} />
        <div className="field-row">
          <Field label={t.serviceForm.date}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t.serviceForm.odo(unitLabel())} hint={prev != null ? t.serviceForm.prev(fmtDist(prev)) : undefined}>
            <input
              inputMode="numeric"
              value={odo}
              onChange={(e) => setOdo(e.target.value)}
              placeholder={prev != null ? fmtNum(fromKm(prev)) : ""}
            />
          </Field>
        </div>
        <div className="field-row">
          <Field label={t.fuelForm.liters}>
            <input inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} />
          </Field>
          <Field label={t.serviceForm.sum} hint={price != null ? `≈ ${t.units.perLiter(fmtMoney(price))}` : undefined}>
            <input inputMode="decimal" value={sum} onChange={(e) => setSum(e.target.value)} />
          </Field>
        </div>
        <Field label={t.fuelForm.station}>
          <input
            value={station}
            onChange={(e) => setStation(e.target.value)}
            list={stationsId}
            maxLength={LIMITS.placeLength}
          />
        </Field>
        <Suggest id={stationsId} values={allFuel.map((f) => f.station)} />
        <Field label={t.fuelForm.grade}>
          <select value={grade} onChange={(e) => setGrade(isFuelGrade(e.target.value) ? e.target.value : "")}>
            <option value="">{t.fuelForm.gradeNone}</option>
            {groupsForFuelType(fuelType).map((group) => (
              <optgroup key={group} label={t.fuelGroups[group]}>
                {FUEL_GROUPS[group].map((g) => (
                  <option key={g} value={g}>
                    {t.fuelGrades[g]}
                  </option>
                ))}
              </optgroup>
            ))}
            {/* Марка, якої немає серед запропонованих для цього типу пального, лишається вибраною. */}
            {grade && !groupsForFuelType(fuelType).some((g) => (FUEL_GROUPS[g] as readonly string[]).includes(grade)) && (
              <option value={grade}>{t.fuelGrades[grade]}</option>
            )}
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
          <span>
            {t.fuelForm.full} <span className="muted">{t.fuelForm.fullHint}</span>
          </span>
        </label>
        <Field label={t.fuelForm.note}>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.noteLength} />
        </Field>
        <ReminderFields draft={reminder} onChange={setReminder} baseOdo={baseOdo} baseDate={date} />
        <PhotoField existing={existing} pending={files} onPending={setFiles} />
        <FormFooter error={error} onDelete={record ? remove : undefined} />
      </form>
    </Modal>
  );
}
