import { useId, useState } from "react";
import { fmtMonthKey, todayISO, unitLabel } from "../../shared/format";
import {
  EMPTY_INPUTS,
  PERIODS,
  RECORD_SORTS,
  WISH_SORTS,
  monthEnd,
  periodRange,
  type FilterInputs,
  type RecordSort,
  type WishSort,
} from "../../shared/listview";
import { useT } from "../lib/store";
import { FilterIcon } from "./icons";
import { Field } from "./forms/common";

export type ListView = { inputs: FilterInputs; sort: RecordSort; open: boolean };

const DEFAULT_VIEW: ListView = { inputs: EMPTY_INPUTS, sort: "new", open: false };

/** Фільтр і сортування переживають перехід між вкладками: тримаємо їх поза компонентом, до перезавантаження. */
const remembered = new Map<string, unknown>();

function useRemembered<T>(key: string, initial: T): [T, (patch: Partial<T>) => void] {
  const [value, setValue] = useState<T>(() => (remembered.get(key) as T | undefined) ?? initial);
  const update = (patch: Partial<T>) =>
    setValue((prev) => {
      const next = { ...prev, ...patch };
      remembered.set(key, next);
      return next;
    });
  return [value, update];
}

export const useListView = (key: "service" | "fuel") => useRemembered<ListView>(key, DEFAULT_VIEW);

export const useWishSort = (): [WishSort, (sort: WishSort) => void] => {
  const [view, update] = useRemembered<{ sort: WishSort }>("wishes", { sort: "added" });
  return [view.sort, (sort) => update({ sort })];
};

export const hasInputs = (inputs: FilterInputs): boolean => Object.values(inputs).some((v) => v.trim() !== "");

/** Кнопка фільтра й вибір порядку: ліворуч над списком. */
export function ListControls({
  view,
  onChange,
  panelId,
}: {
  view: ListView;
  onChange: (patch: Partial<ListView>) => void;
  panelId: string;
}) {
  const t = useT();
  const active = hasInputs(view.inputs);
  return (
    <div className="list-controls">
      <button
        type="button"
        className={`btn btn-quiet btn-small${active ? " is-on" : ""}`}
        aria-expanded={view.open}
        aria-controls={panelId}
        onClick={() => onChange({ open: !view.open })}
      >
        <FilterIcon size={16} /> {t.list.filter}
        {active && <span className="filter-dot" aria-hidden="true" />}
      </button>
      <SortSelect value={view.sort} options={RECORD_SORTS} labels={t.list.sorts} onChange={(sort) => onChange({ sort })} />
    </div>
  );
}

export function SortSelect<S extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: S;
  options: readonly S[];
  labels: Record<S, string>;
  onChange: (value: S) => void;
}) {
  const t = useT();
  return (
    <select className="sort-select" aria-label={t.list.sort} value={value} onChange={(e) => onChange(e.target.value as S)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels[o]}
        </option>
      ))}
    </select>
  );
}

export const WishSortSelect = ({ value, onChange }: { value: WishSort; onChange: (sort: WishSort) => void }) => {
  const t = useT();
  return <SortSelect value={value} options={WISH_SORTS} labels={t.list.wishSorts} onChange={onChange} />;
};

/** Панель фільтра: готові періоди, місяць зі списку, свої дати й відрізок пробігу. Фільтрує одразу. */
export function FilterPanel({
  id,
  inputs,
  months,
  onChange,
  onClose,
}: {
  id: string;
  inputs: FilterInputs;
  /** Місяці, за які є записи, від нових до старих. */
  months: string[];
  onChange: (inputs: FilterInputs) => void;
  onClose: () => void;
}) {
  const t = useT();
  const periodId = useId();
  const today = todayISO();
  const set = (patch: Partial<FilterInputs>) => onChange({ ...inputs, ...patch });
  const month = months.find((m) => inputs.from === `${m}-01` && inputs.to === monthEnd(m)) ?? "";
  const unit = unitLabel();

  return (
    <section id={id} className="sheet filter-panel" aria-label={t.list.filter}>
      <div className="field">
        <span className="field-label" id={periodId}>
          {t.list.period}
        </span>
        <div className="chip-grid" role="group" aria-labelledby={periodId}>
          {PERIODS.map((p) => {
            const range = periodRange(p, today);
            const on = inputs.from === range.from && inputs.to === range.to;
            return (
              <button
                key={p}
                type="button"
                className={`pick${on ? " is-on" : ""}`}
                aria-pressed={on}
                onClick={() => set(on ? { from: "", to: "" } : range)}
              >
                {t.list.periods[p]}
              </button>
            );
          })}
        </div>
      </div>
      {months.length > 0 && (
        <Field label={t.list.month}>
          <select
            value={month}
            onChange={(e) => {
              const m = e.target.value;
              set(m ? { from: `${m}-01`, to: monthEnd(m) } : { from: "", to: "" });
            }}
          >
            <option value="">{t.list.anyMonth}</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {fmtMonthKey(m)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="field-row">
        <Field label={t.list.from}>
          <input type="date" value={inputs.from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field label={t.list.to}>
          <input type="date" value={inputs.to} onChange={(e) => set({ to: e.target.value })} />
        </Field>
      </div>
      <div className="field-row">
        <Field label={t.list.odoFrom(unit)}>
          <input inputMode="numeric" value={inputs.odoFrom} onChange={(e) => set({ odoFrom: e.target.value })} />
        </Field>
        <Field label={t.list.odoTo(unit)}>
          <input inputMode="numeric" value={inputs.odoTo} onChange={(e) => set({ odoTo: e.target.value })} />
        </Field>
      </div>
      <div className="btn-row">
        <button type="button" className="btn btn-quiet btn-small" onClick={() => onChange(EMPTY_INPUTS)}>
          {t.list.reset}
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-ink btn-small" onClick={onClose}>
          {t.list.done}
        </button>
      </div>
    </section>
  );
}

/** Під панеллю, поки фільтр діє: скільки записів показано, їхня сума і «Скинути». */
export function FilterResult({ shown, total, sum, onReset }: { shown: number; total: number; sum: string; onReset: () => void }) {
  const t = useT();
  return (
    <p className="filter-result" role="status">
      <span>{t.list.shown(shown, total)}</span>
      <span className="num">{sum}</span>
      <button type="button" className="link-btn" onClick={onReset}>
        {t.list.reset}
      </button>
    </p>
  );
}
