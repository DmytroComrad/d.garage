import { memo } from "react";
import { fuelChipTone, sumMoney, type FuelCalc } from "../../shared/calc";
import { fmtConsumption, fmtDate, fmtKm, fmtLiters, fmtLiters1, fmtMoney, fmtMoney0, fmtNum } from "../../shared/format";
import type { FuelRecord, Photo } from "../../shared/types";
import { openDialog, useCarView } from "../lib/store";
import { NO_PHOTOS } from "../lib/view";
import { ConsumptionChart } from "./Charts";
import { EmptyState, KeyValue, LedgerRow, MonthGroup, Summary, groupByMonth } from "./Ledger";

const FuelRow = memo(function FuelRow({
  record,
  calc,
  avg,
  photos,
}: {
  record: FuelRecord;
  calc: FuelCalc | undefined;
  avg: number | null;
  photos: Photo[];
}) {
  const meta = [
    fmtDate(record.date),
    fmtKm(record.odo),
    fmtLiters(record.liters),
    calc ? `${fmtMoney(calc.price)}/л` : "",
    calc?.sinceLast != null ? `+${fmtKm(calc.sinceLast)}` : "",
    record.note,
  ];
  const tone = fuelChipTone(calc?.consumption ?? null, avg);
  return (
    <LedgerRow
      kind="fuel"
      title={record.station || "Заправка"}
      meta={meta.filter(Boolean).join(" · ")}
      sum={fmtMoney(record.sum)}
      badge={
        !record.full ? (
          <span className="tag">не полный бак</span>
        ) : calc?.consumption != null ? (
          <span className={`chip-use chip-${tone}`}>{fmtConsumption(calc.consumption)}</span>
        ) : null
      }
      photos={photos}
      onOpen={() => openDialog({ type: "fuel", record })}
    />
  );
});

export function FuelTab({ carId }: { carId: string }) {
  const { fuel, calcs, fuelTotals: f, photosByRecord } = useCarView(carId);
  const sorted = [...fuel].sort((a, b) => b.date.localeCompare(a.date) || b.odo - a.odo);

  return (
    <div className="columns">
      <aside className="side">
        <Summary title="Сводка по топливу">
          <dl className="kvs">
            <KeyValue label="Средний расход" value={fmtConsumption(f.avg)} big tone="fuel" />
            <KeyValue label="Последний" value={fmtConsumption(f.last)} />
            <hr />
            <KeyValue label="Заправок" value={fmtNum(f.count)} />
            <KeyValue label="Залито" value={fmtLiters(f.liters)} />
            <KeyValue label="Потрачено на топливо" value={fmtMoney(f.spent)} />
            <KeyValue label="Средняя цена литра" value={fmtMoney(f.avgPrice)} />
            <KeyValue label="Топливо на 1 км" value={fmtMoney(f.perKm)} />
          </dl>
          <p className="side-note">
            Расход считается между двумя заправками «до полного». Если заправился частично — сними галочку «Полный
            бак», литры учтутся в следующем полном.
          </p>
          {f.points.length >= 2 && <ConsumptionChart points={f.points} avg={f.avg} height={150} />}
        </Summary>
      </aside>

      <div className="list">
        {sorted.length === 0 ? (
          <EmptyState
            title="Заправок пока нет"
            text="Записывай пробег, литры и сумму с чека — расход посчитается сам между полными баками."
          >
            <button type="button" className="btn btn-fuel" onClick={() => openDialog({ type: "fuel", car: carId })}>
              Первая заправка
            </button>
          </EmptyState>
        ) : (
          groupByMonth(sorted).map(([key, records]) => {
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
                  />
                ))}
              </MonthGroup>
            );
          })
        )}
      </div>
    </div>
  );
}
