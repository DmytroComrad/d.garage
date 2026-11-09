import { useMemo, useState } from "react";
import { itemKindTotals, monthly } from "../../shared/calc";
import { categoryLabel, itemKindLabel } from "../../shared/constants";
import {
  fmtConsumption,
  fmtConsumptionValue,
  fmtLiters1,
  fmtMoney,
  fmtMoney0,
  fmtMonthKey,
  fmtNum,
  todayISO,
} from "../../shared/format";
import { fuelFacts, fuelGroups, stationKey, type FuelGroupStat } from "../../shared/fuelStats";
import { isFuelGrade } from "../../shared/fuelGrades";
import { dismissFuelNote, useCarView, useStore, useT } from "../lib/store";
import { ConsumptionChart, MonthlyChart } from "./Charts";
import { InfoIcon } from "./icons";
import { EmptyState, MoneyBars } from "./Ledger";

/** Таблиця «АЗС або марка → заправки, літри, ціна літра, витрата». */
function FuelTable({ title, column, rows, nameOf }: { title: string; column: string; rows: FuelGroupStat[]; nameOf: (key: string) => string }) {
  const t = useT();
  const unit = useStore((s) => s.prefs.unit);
  return (
    <section className="sheet stat-sheet">
      <h3 className="sheet-title">{title}</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{column}</th>
              <th scope="col">{t.stats.colFills}</th>
              <th scope="col">{t.stats.colLiters}</th>
              <th scope="col">{t.stats.colPrice}</th>
              <th scope="col">{t.stats.colUse(t.units.per100[unit])}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{nameOf(r.key)}</th>
                <td>{fmtNum(r.fills)}</td>
                <td>{fmtLiters1(r.liters)}</td>
                <td>{r.avgPrice !== null ? fmtMoney(r.avgPrice) : t.stats.noUse}</td>
                <td>{r.consumption !== null ? fmtConsumptionValue(r.consumption) : t.stats.noUse}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Чесне застереження: витрата залежить не лише від пального. Розгорнуте, доки не натиснуть «Зрозуміло». */
function FuelNote() {
  const t = useT();
  const seen = useStore((s) => s.fuelNoteSeen);
  const [open, setOpen] = useState(false);
  if (seen && !open) {
    return (
      <button type="button" className="link-btn note-link" onClick={() => setOpen(true)}>
        <InfoIcon size={16} /> {t.fuelNote.link}
      </button>
    );
  }
  return (
    <section className="note" aria-label={t.fuelNote.title}>
      <p className="note-title">
        <InfoIcon size={18} /> <strong>{t.fuelNote.title}</strong>
      </p>
      <p>{t.fuelNote.text}</p>
      <div>
        <button
          type="button"
          className="btn btn-ink btn-small"
          onClick={() => {
            dismissFuelNote();
            setOpen(false);
          }}
        >
          {t.common.gotIt}
        </button>
      </div>
    </section>
  );
}

export function StatsTab({ carId }: { carId: string }) {
  const t = useT();
  const unit = useStore((s) => s.prefs.unit);
  // Гроші — у записах, перерахованих в основну валюту за курсом на дату кожного.
  const { serviceMain: service, fuelMain: fuel, summary: s, fuelTotals: f } = useCarView(carId);
  const months = useMemo(() => monthly(service, fuel, todayISO()), [service, fuel]);
  const kinds = useMemo(() => itemKindTotals(service), [service]);
  const stations = useMemo(() => fuelGroups(fuel, (r) => stationKey(r.station)), [fuel]);
  const grades = useMemo(() => fuelGroups(fuel, (r) => r.grade), [fuel]);
  // АЗС показуємо так, як її записали вперше, а групуємо без регістру.
  const stationNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const r of [...fuel].sort((a, b) => a.date.localeCompare(b.date))) {
      const key = stationKey(r.station);
      if (key && !names.has(key)) names.set(key, r.station.trim());
    }
    return names;
  }, [fuel]);

  if (!s.hasRecords) {
    return <EmptyState narrow title={t.stats.emptyTitle} text={t.stats.emptyText} />;
  }

  const money = [
    ...(s.fuelTotal > 0 ? [{ key: "fuel", name: t.stats.fuel, sum: s.fuelTotal, fuel: true }] : []),
    ...s.categories.map((c) => ({ key: `cat:${c.name}`, name: categoryLabel(c.name), sum: c.sum })),
  ].sort((a, b) => b.sum - a.sum);
  const hasItems = kinds.some((k) => k.kind !== "none");
  const stationName = (key: string) => stationNames.get(key) ?? key;
  const gradeName = (key: string) => (isFuelGrade(key) ? t.fuelGrades[key] : key);
  // Висновки: спершу за АЗС, а якщо АЗС не вказують — за марками.
  const facts = stations.length >= 2 ? fuelFacts(stations).map((x) => ({ ...x, name: stationName })) : [];
  if (!facts.length) facts.push(...fuelFacts(grades).map((x) => ({ ...x, name: gradeName })));
  const showGroups = stations.length > 0 || grades.length > 0;

  return (
    <div className="stats">
      <h2 className="stats-section">{t.stats.sectionMoney}</h2>
      <section className="sheet stat-sheet stat-wide">
        <h3 className="sheet-title">{t.stats.monthly}</h3>
        <MonthlyChart rows={months} />
        <details className="chart-table">
          <summary>{t.stats.table}</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.stats.month}</th>
                  <th scope="col">{t.stats.service}</th>
                  <th scope="col">{t.stats.fuel}</th>
                  <th scope="col">{t.stats.total}</th>
                  <th scope="col">{t.stats.liters}</th>
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map((r) => (
                  <tr key={r.key}>
                    <th scope="row">{fmtMonthKey(r.key)}</th>
                    <td>{fmtMoney0(r.service)}</td>
                    <td>{fmtMoney0(r.fuel)}</td>
                    <td>{fmtMoney0(r.total)}</td>
                    <td>{fmtLiters1(r.liters)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="sheet stat-sheet">
        <h3 className="sheet-title">{t.stats.whereMoney}</h3>
        <MoneyBars rows={money} total={s.total} />
      </section>
      {hasItems && (
        <section className="sheet stat-sheet">
          <h3 className="sheet-title">{t.stats.partsLabor}</h3>
          <MoneyBars
            rows={kinds.map((k) => ({
              key: k.kind,
              name: k.kind === "none" ? t.stats.noBreakdown : itemKindLabel(k.kind),
              sum: k.sum,
            }))}
            total={s.serviceTotal}
          />
        </section>
      )}

      {fuel.length > 0 && (
        <>
          <h2 className="stats-section">{t.stats.sectionFuel}</h2>
          <section className="sheet stat-sheet stat-wide">
            <div className="sheet-head">
              <h3 className="sheet-title">{t.stats.consumption(t.units.per100Long[unit])}</h3>
              {f.avg != null && <span className="muted num">{t.stats.avg(fmtConsumptionValue(f.avg))}</span>}
            </div>
            {f.points.length > 0 ? <ConsumptionChart points={f.points} avg={f.avg} /> : <p className="muted">{t.stats.needTwo}</p>}
          </section>

          {stations.length > 0 && <FuelTable title={t.stats.byStation} column={t.stats.colStation} rows={stations} nameOf={stationName} />}
          {grades.length > 0 && <FuelTable title={t.stats.byGrade} column={t.stats.colGrade} rows={grades} nameOf={gradeName} />}

          <div className="stat-wide stat-notes">
            {facts.length > 0 && (
              <ul className="facts">
                {facts.map((x) => (
                  <li key={x.kind}>
                    {x.kind === "price"
                      ? t.stats.factPrice(x.name(x.cheap), x.name(x.dear), fmtMoney(x.diff))
                      : t.stats.factUse(x.name(x.low), x.name(x.high), fmtConsumption(x.lowValue), fmtConsumption(x.highValue))}
                  </li>
                ))}
              </ul>
            )}
            {showGroups ? <FuelNote /> : <p className="muted">{t.stats.byStationHint}</p>}
          </div>
        </>
      )}
    </div>
  );
}
