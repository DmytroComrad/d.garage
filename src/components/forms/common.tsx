import { useMemo, useState, type ReactNode } from "react";
import { CURRENCIES, CURRENCY_SYMBOLS, type Currency } from "../../../shared/currency";
import { genId, todayISO } from "../../../shared/format";
import { mainCurrency } from "../../../shared/prefs";
import { buildReminder, reminderDraft } from "../../../shared/reminders";
import type { Op, Reminder } from "../../../shared/types";
import { uploadPhotos } from "../../lib/photos";
import { TrashIcon } from "../icons";
import { messages } from "../../../shared/i18n";
import { closeDialog, currentOdo, dueReminderDialog, setActive, toast, useStore, useT } from "../../lib/store";

export const Field = ({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) => (
  <label className="field">
    <span className="field-label">{label}</span>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </label>
);

export const CarSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const t = useT();
  const cars = useStore((s) => s.data.cars);
  if (cars.length < 2) return null;
  return (
    <Field label={t.serviceForm.car}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {cars.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </Field>
  );
};

/** Валюта нового запису — основна з налаштувань; запис, який редагують, лишається у своїй. */
export const useMainCurrency = (): Currency => useStore((s) => mainCurrency(s.prefs));

/** Компактний вибір валюти поруч із сумою. Інша валюта не перераховує вписане число: людина пише суму з чека. */
export const CurrencySelect = ({ value, onChange }: { value: Currency; onChange: (c: Currency) => void }) => {
  const t = useT();
  return (
    <select
      className="currency-select"
      aria-label={t.currency.pick}
      value={value}
      onChange={(e) => onChange(e.target.value as Currency)}
    >
      {CURRENCIES.map((c) => (
        <option key={c} value={c} title={c}>
          {CURRENCY_SYMBOLS[c]}
        </option>
      ))}
    </select>
  );
};

/** Поле суми з вибором валюти праворуч. */
export const MoneyInput = ({
  children,
  currency,
  onCurrency,
}: {
  children: ReactNode;
  currency: Currency;
  onCurrency: (c: Currency) => void;
}) => (
  <span className="input-with-currency">
    {children}
    <CurrencySelect value={currency} onChange={onCurrency} />
  </span>
);

export const Suggest = ({ id, values }: { id: string; values: string[] }) => (
  <datalist id={id}>
    {[...new Set(values.filter(Boolean))].sort().map((v) => (
      <option key={v} value={v} />
    ))}
  </datalist>
);

/** Максимальний пробіг машини серед усіх записів, крім того, що редагується. */
export const usePrevOdo = (carId: string, excludeId?: string): number | null => {
  const service = useStore((s) => s.data.service);
  const fuel = useStore((s) => s.data.fuel);
  return useMemo(() => {
    let max: number | null = null;
    for (const r of [...service, ...fuel]) {
      if (r.car === carId && r.id !== excludeId && r.odo != null && (max == null || r.odo > max)) max = r.odo;
    }
    return max;
  }, [service, fuel, carId, excludeId]);
};

/** Нагадування, прив'язане до запису: його показує і редагує форма. */
export const useLinkedReminder = (recordId: string | undefined): Reminder | undefined =>
  useStore((s) => (recordId ? s.data.reminders.find((r) => r.recordId === recordId && !r.done) : undefined));

export const useReminderDraft = (linked: Reminder | undefined, baseOdo: number | null) =>
  useState(() => reminderDraft(linked, baseOdo));

export const reminderForRecord = (
  draft: Parameters<typeof buildReminder>[0],
  opts: { car: string; recordId: string; baseOdo: number | null; fallbackTitle: string; linked?: Reminder },
) => buildReminder(draft, { ...opts, today: todayISO(), makeId: genId });

export const reminderOps = (built: Reminder | null, linked?: Reminder): Op[] => {
  if (built) return [{ type: "reminder.put", data: built }];
  return linked ? [{ type: "reminder.del", id: linked.id }] : [];
};

export const carOdo = (carId: string): number | null => (carId ? currentOdo(carId) : null);

/** Вікно нагадування саме показує, що запис прийнято: тост лише перекрив би його. */
export const finishSave = (car: string, isNew: boolean, files: File[], recordId: string): void => {
  setActive(car);
  const next = dueReminderDialog(car, isNew);
  closeDialog(next);
  if (!next) toast(messages().common.saved);
  void uploadPhotos(files, { car, kind: "record", recordId });
};

export const ConfirmDelete = ({ question, onDelete }: { question: string; onDelete: () => void }) => {
  const t = useT();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="btn btn-danger-quiet" onClick={() => setAsking(true)}>
        <TrashIcon size={16} /> {t.common.delete}
      </button>
    );
  }
  return (
    <span className="confirm-inline">
      <span>{question}</span>
      <button type="button" className="btn btn-danger" onClick={onDelete}>
        {t.common.yesDelete}
      </button>
    </span>
  );
};

export const FormFooter = ({
  error,
  onDelete,
  deleteQuestion,
  submitLabel,
}: {
  error: string;
  onDelete?: () => void;
  deleteQuestion?: string;
  submitLabel?: string;
}) => {
  const t = useT();
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        {onDelete && <ConfirmDelete question={deleteQuestion ?? t.common.deleteRecordQ} onDelete={onDelete} />}
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" onClick={() => closeDialog()}>
          {t.common.cancel}
        </button>
        <button type="submit" className="btn btn-ink">
          {submitLabel ?? t.common.save}
        </button>
      </div>
    </>
  );
};
