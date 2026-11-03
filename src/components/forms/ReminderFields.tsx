import { useId } from "react";
import { LIMITS } from "../../../shared/constants";
import { fmtDist, fmtNum, fmtUnits, todayISO, unitLabel } from "../../../shared/format";
import { parseOdo } from "../../../shared/parse";
import { toKm } from "../../../shared/prefs";
import { DIST_PRESETS, DIST_THRESHOLDS, addMonths, type ReminderDraft } from "../../../shared/reminders";
import { useStore, useT } from "../../lib/store";
import { ReminderNote } from "../ReminderNote";
import { Field, Suggest } from "./common";

/** Блок «Напомнить через…» у формі запису. Відстань — у вибраних одиницях. */
export function ReminderFields({
  draft,
  onChange,
  baseOdo,
  baseDate,
}: {
  draft: ReminderDraft;
  onChange: (d: ReminderDraft) => void;
  baseOdo: number | null;
  baseDate: string;
}) {
  const t = useT();
  const unit = useStore((s) => s.prefs.unit);
  const listId = useId();
  const reminders = useStore((s) => s.data.reminders);
  const km = parseOdo(draft.km);
  const target = typeof km === "number" && km > 0 && baseOdo != null ? baseOdo + toKm(km) : null;
  const months: [number, string][] = [
    [6, t.reminderFields.halfYear],
    [12, t.reminderFields.year],
  ];
  const limits = DIST_THRESHOLDS[unit];

  return (
    <div className={`reminder-box${draft.on ? " is-on" : ""}`}>
      <label className="check">
        <input type="checkbox" checked={draft.on} onChange={(e) => onChange({ ...draft, on: e.target.checked })} />
        <span>{t.reminderFields.toggle}</span>
      </label>
      {draft.on && (
        <div className="reminder-fields">
          <Field label={t.reminderFields.what}>
            <input
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              placeholder={t.reminderFields.placeholder}
              list={listId}
              maxLength={LIMITS.titleLength}
            />
          </Field>
          <Suggest id={listId} values={reminders.map((r) => r.title)} />
          <div className="field-row">
            <Field
              label={t.reminderFields.inDist(unitLabel())}
              hint={target != null ? t.reminderFields.target(fmtDist(target)) : undefined}
            >
              <input
                inputMode="numeric"
                value={draft.km}
                onChange={(e) => onChange({ ...draft, km: e.target.value })}
                placeholder={fmtNum(DIST_PRESETS[unit][1])}
              />
            </Field>
            <Field label={t.reminderFields.orDate}>
              <input type="date" value={draft.date} onChange={(e) => onChange({ ...draft, date: e.target.value })} />
            </Field>
          </div>
          <div className="preset-row">
            {DIST_PRESETS[unit].map((v) => (
              <button
                key={v}
                type="button"
                className={`preset${km === v ? " is-on" : ""}`}
                onClick={() => onChange({ ...draft, km: String(v) })}
              >
                {fmtUnits(v)}
              </button>
            ))}
            {months.map(([count, label]) => {
              const value = addMonths(baseDate || todayISO(), count);
              return (
                <button
                  key={count}
                  type="button"
                  className={`preset${draft.date === value ? " is-on" : ""}`}
                  onClick={() => onChange({ ...draft, date: value })}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="field-hint">{t.reminderFields.hint(fmtNum(limits.first), fmtUnits(limits.second))}</p>
          <ReminderNote />
        </div>
      )}
    </div>
  );
}
