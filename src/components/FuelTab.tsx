import { memo, useId, useMemo } from "react";
import { fuelChipTone, sumMoney, type FuelCalc } from "../../shared/calc";
import { fmtConsumption, fmtDate, fmtDist, fmtLiters, fmtLiters1, fmtMoney, fmtMoney0, fmtNum, fmtPerDist } from "../../shared/format";
import { EMPTY_INPUTS, filterFromInputs, filterRecords, recordMonths, sortRecords, sortsByDate } from "../../shared/listview";
import type { FuelRecord, Photo } from "../../shared/types";
import { deleteRecords, openDialog, toast, useCarView, useStore, useT } from "../lib/store";
import { NO_PHOTOS } from "../lib/view";
import { ConsumptionChart } from "./Charts";
import { FilterPanel, FilterResult, ListControls, hasInputs, useListView } from "./ListTools";
import {
  EmptyState,
  KeyValue,
  LedgerRow,
  MonthGroup,
  SelectBar,
  SelectToggle,
  Summary,
  groupByMonth,
  useSelection,
  type RowSelect,
} from "./Ledger";

const FuelRow = memo(function FuelRow({
  record,
  calc,
  avg,
  photos,
  select,
}: {
  record: FuelRecord;
  calc: FuelCalc | undefined;
  avg: number | null;
  photos: Photo[];
  select?: RowSelect;
}) {
  const t = useT();
  const meta = [
    fmtDate(record.date),
    fmtDist(record.odo),
    fmtLiters(record.liters),
    record.grade ? t.fuelGrades[record.grade] : "",
    calc ? t.units.perLiter(fmtMoney(calc.price)) : "",
    calc?.sinceLast != null ? `+${fmtDist(calc.sinceLast)}` : "",
    record.note,
  ];
  const tone = fuelChipTone(calc?.consumption ?? null, avg);
  return (
    <LedgerRow
      id={record.id}
      kind="fuel"
      title={record.station || t.fuel.defaultTitle}
      meta={meta.filter(Boolean).join(" · ")}
      sum={fmtMoney(record.sum)}
      badge={
        !record.full ? (
          <span className="tag">{t.fuel.notFull}</span>
        ) : calc?.consumption != null ? (
          <span className={`chip-use chip-${tone}`}>{fmtConsumption(calc.consumption)}</span>
        ) : null
      }
      photos={photos}
      onOpen={() => openDialog({ type: "fuel", record })}
      select={select}
    />
  );
});

export function FuelTab({ carId }: { carId: string }) {
  const t = useT();
  const unit = useStore((s) => s.prefs.unit);
  const { fuel, calcs, fuelTotals: f, photosByRecord } = useCarView(carId);
  const [view, setView] = useListView("fuel");
  const panelId = useId();
  const months = useMemo(() => recordMonths(fuel), [fuel]);
  const shown = useMemo(
    () => sortRecords(filterRecords(fuel, filterFromInputs(view.inputs, unit)), view.sort),
    [fuel, view.inputs, view.sort, unit],
  );
  const selection = useSelection(shown.map((r) => r.id));
  const totals = (records: FuelRecord[]) =>
    `${fmtLiters1(records.reduce((acc, r) => acc + r.liters, 0))} · ${fmtMoney0(sumMoney(records.map((r) => r.sum)))}`;
  const row = (r: FuelRecord) => (
    <FuelRow
      key={r.id}
      record={r}
      calc={calcs.get(r.id)}
      avg={f.avg}
      photos={photosByRecord.get(r.id) ?? NO_PHOTOS}
      select={selection.on ? { checked: selection.isPicked(r.id), onToggle: selection.toggle } : undefined}
    />
  );

  return (
    <div className="columns">
      <aside className="side">
        <Summary title={t.fuel.summary}>
          <dl className="kvs">
            <KeyValue label={t.fuel.avg} value={fmtConsumption(f.avg)} big tone="fuel" />
            <KeyValue label={t.fuel.last} value={fmtConsumption(f.last)} />
            <hr />
            <KeyValue label={t.fuel.count} value={fmtNum(f.count)} />
            <KeyValue label={t.fuel.poured} value={fmtLiters(f.liters)} />
            <KeyValue label={t.fuel.spent} value={fmtMoney(f.spent)} />
            <KeyValue label={t.fuel.avgPrice} value={fmtMoney(f.avgPrice)} />
            <KeyValue label={t.fuel.perDist[unit]} value={fmtPerDist(f.perKm)} />
          </dl>
          <p className="side-note">{t.fuel.note}</p>
          {f.points.length >= 2 && <ConsumptionChart points={f.points} avg={f.avg} height={150} />}
        </Summary>
      </aside>

      <div className="list">
        {fuel.length === 0 ? (
          <EmptyState title={t.fuel.emptyTitle} text={t.fuel.emptyText}>
            <button type="button" className="btn btn-fuel" onClick={() => openDialog({ type: "fuel", car: carId })}>
              {t.fuel.first}
            </button>
          </EmptyState>
        ) : (
          <>
            <SelectToggle selection={selection}>
              <ListControls view={view} onChange={setView} panelId={panelId} />
            </SelectToggle>
            {view.open && (
              <FilterPanel
                id={panelId}
                inputs={view.inputs}
                months={months}
                onChange={(inputs) => setView({ inputs })}
                onClose={() => setView({ open: false })}
              />
            )}
            {hasInputs(view.inputs) && (
              <FilterResult
                shown={shown.length}
                total={fuel.length}
                sum={totals(shown)}
                onReset={() => setView({ inputs: EMPTY_INPUTS })}
              />
            )}
            {shown.length === 0 ? (
              <EmptyState title={t.list.nothingTitle} text={t.list.nothingText} />
            ) : sortsByDate(view.sort) ? (
              groupByMonth(shown).map(([key, records]) => (
                <MonthGroup key={key} monthKey={key} total={totals(records)}>
                  {records.map(row)}
                </MonthGroup>
              ))
            ) : (
              <div className="sheet ledger">{shown.map(row)}</div>
            )}
            <SelectBar
              selection={selection}
              onDelete={(ids) => {
                deleteRecords("fuel", ids);
                toast(t.select.deleted(ids.length));
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
