import { fuelCalcs, fuelChipTone, fuelSummary, sumMoney } from "../../shared/calc";
import { fmtConsumption, fmtDate, fmtKm, fmtLiters, fmtLiters1, fmtMoney, fmtMoney0, fmtMonthKey, fmtNum } from "../../shared/format";
import { carRecords, openDialog, useApp } from "../lib/store";
import { ConsumptionChart } from "./Charts";
import { PumpIcon } from "./icons";
import { Mono } from "./Mono";
import { RecordPhotos, Row, Summary, groupByMonth } from "./ServiceTab";

export function FuelTab({ carId }: { carId: string }) {
  const { data } = useApp();
  const { fuel, photos } = carRecords(data, carId);
  const f = fuelSummary(fuel);
  const calcs = fuelCalcs(fuel);
  const sorted = [...fuel].sort((a, b) => b.date.localeCompare(a.date) || b.odo - a.odo);

  return (
    <div className="columns">
      <aside className="side">
        <Summary title="Сводка по топливу">
          <dl className="kvs">
            <Row label="Средний расход" value={fmtConsumption(f.avg)} big tone="fuel" />
            <Row label="Последний" value={fmtConsumption(f.last)} />
            <hr />
            <Row label="Заправок" value={fmtNum(f.count)} />
            <Row label="Залито" value={fmtLiters(f.liters)} />
            <Row label="Потрачено на топливо" value={fmtMoney(f.spent)} />
            <Row label="Средняя цена литра" value={fmtMoney(f.avgPrice)} />
            <Row label="Топливо на 1 км" value={fmtMoney(f.perKm)} />
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
          <div className="empty">
            <h2>Заправок пока нет</h2>
            <p>Записывай пробег, литры и сумму с чека — расход посчитается сам между полными баками.</p>
            <button type="button" className="btn btn-fuel" onClick={() => openDialog({ type: "fuel", car: carId })}>
              Первая заправка
            </button>
          </div>
        ) : (
          groupByMonth(sorted).map(([key, records]) => {
            const liters = records.reduce((acc, r) => acc + r.liters, 0);
            return (
              <section key={key} className="month">
                <header className="month-head">
                  <h3>{fmtMonthKey(key)}</h3>
                  <span className="num">
                    {fmtLiters1(liters)} · {fmtMoney0(sumMoney(records.map((r) => r.sum)))}
                  </span>
                </header>
                <div className="sheet ledger">
                  {records.map((r) => {
                    const c = calcs.get(r.id);
                    const tone = fuelChipTone(c?.consumption ?? null, f.avg);
                    const meta = [
                      fmtDate(r.date),
                      fmtKm(r.odo),
                      fmtLiters(r.liters),
                      c ? `${fmtMoney(c.price)}/л` : "",
                      c?.sinceLast != null ? `+${fmtKm(c.sinceLast)}` : "",
                      r.note,
                    ].filter(Boolean);
                    return (
                      <article key={r.id} className="rec">
                        <button type="button" className="rec-main" onClick={() => openDialog({ type: "fuel", record: r })}>
                          <span className="rec-icon rec-icon-fuel">
                            <PumpIcon />
                          </span>
                          <span className="rec-body">
                            <span className="rec-title">{r.station || "Заправка"}</span>
                            <span className="rec-meta"><Mono text={meta.join(" · ")} /></span>
                          </span>
                          <span className="rec-side">
                            <span className="rec-sum num">{fmtMoney(r.sum)}</span>
                            {!r.full ? (
                              <span className="tag">не полный бак</span>
                            ) : c?.consumption != null ? (
                              <span className={`chip-use chip-${tone}`}>{fmtConsumption(c.consumption)}</span>
                            ) : null}
                          </span>
                        </button>
                        <RecordPhotos photos={photos.filter((p) => p.recordId === r.id)} />
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
