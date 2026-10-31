import { useId } from "react";
import { LIMITS } from "../../../shared/constants";
import { fmtKm, fmtNum, todayISO } from "../../../shared/format";
import { parseOdo } from "../../../shared/parse";
import { addMonths, type ReminderDraft } from "../../../shared/reminders";
import { useStore } from "../../lib/store";
import { Field, Suggest } from "./common";

export const KM_PRESETS = [5000, 10000, 15000];
const MONTH_PRESETS: [number, string][] = [
  [6, "через полгода"],
  [12, "через год"],
];

/** Блок «Напомнить через…» у формі запису. */
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
  const listId = useId();
  const reminders = useStore((s) => s.data.reminders);
  const km = parseOdo(draft.km);
  const target = typeof km === "number" && km > 0 && baseOdo != null ? baseOdo + km : null;

  return (
    <div className={`reminder-box${draft.on ? " is-on" : ""}`}>
      <label className="check">
        <input type="checkbox" checked={draft.on} onChange={(e) => onChange({ ...draft, on: e.target.checked })} />
        <span>Напомнить через…</span>
      </label>
      {draft.on && (
        <div className="reminder-fields">
          <Field label="Что нужно сделать или заменить">
            <input
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              placeholder="Например: замена масла"
              list={listId}
              maxLength={LIMITS.titleLength}
            />
          </Field>
          <Suggest id={listId} values={reminders.map((r) => r.title)} />
          <div className="field-row">
            <Field label="Через, км" hint={target != null ? `На пробеге ${fmtKm(target)}` : undefined}>
              <input
                inputMode="numeric"
                value={draft.km}
                onChange={(e) => onChange({ ...draft, km: e.target.value })}
                placeholder="10 000"
              />
            </Field>
            <Field label="Или к дате">
              <input type="date" value={draft.date} onChange={(e) => onChange({ ...draft, date: e.target.value })} />
            </Field>
          </div>
          <div className="preset-row">
            {KM_PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                className={`preset${km === v ? " is-on" : ""}`}
                onClick={() => onChange({ ...draft, km: String(v) })}
              >
                {fmtNum(v)} км
              </button>
            ))}
            {MONTH_PRESETS.map(([months, label]) => {
              const value = addMonths(baseDate || todayISO(), months);
              return (
                <button
                  key={months}
                  type="button"
                  className={`preset${draft.date === value ? " is-on" : ""}`}
                  onClick={() => onChange({ ...draft, date: value })}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="field-hint">Покажем уведомление за 1000 и за 500 км, а по дате — за месяц и за неделю.</p>
        </div>
      )}
    </div>
  );
}
