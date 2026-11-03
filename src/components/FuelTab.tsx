import { memo } from "react";
import { fuelChipTone, sumMoney, type FuelCalc } from "../../shared/calc";
import { fmtConsumption, fmtDate, fmtDist, fmtLiters, fmtLiters1, fmtMoney, fmtMoney0, fmtNum, fmtPerDist } from "../../shared/format";
import type { FuelRecord, Photo } from "../../shared/types";
import { deleteRecords, openDialog, toast, useCarView, useStore, useT } from "../lib/store";
import { NO_PHOTOS } from "../lib/view";
import { ConsumptionChart } from "./Charts";
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
  const sorted = [...fuel].sort((a, b) => b.date.localeCompare(a.date) || b.odo - a.odo);
  const selection = useSelection(sorted.map((r) => r.id));

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
        {sorted.length === 0 ? (
          <EmptyState title={t.fuel.emptyTitle} text={t.fuel.emptyText}>
            <button type="button" className="btn btn-fuel" onClick={() => openDialog({ type: "fuel", car: carId })}>
              {t.fuel.first}
            </button>
          </EmptyState>
        ) : (
          <>
            <SelectToggle selection={selection} />
            {groupByMonth(sorted).map(([key, records]) => {
              const liters = records.reduce((acc, r) => acc + r.liters, 0);
              return (
                <MonthGroup
                  key={key}
                  monthKey={key}
                  total={`${fmtLiters1(liters)} · ${fmtMoney0(sumMoney(records.map((r) => r.sum)))}`}
                >
                  {records.map((r) => (
                    <FuelRow
                      key={r.id}
                      record={r}
                      calc={calcs.get(r.id)}
                      avg={f.avg}
                      photos={photosByRecord.get(r.id) ?? NO_PHOTOS}
                      select={selection.on ? { checked: selection.isPicked(r.id), onToggle: selection.toggle } : undefined}
                    />
                  ))}
                </MonthGroup>
              );
            })}
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
