import { useMemo } from "react";
import { itemKindTotals, monthly } from "../../shared/calc";
import { categoryLabel, itemKindLabel } from "../../shared/constants";
import { fmtConsumptionValue, fmtLiters1, fmtMoney0, fmtMonthKey, todayISO } from "../../shared/format";
import { useCarView, useStore, useT } from "../lib/store";
import { ConsumptionChart, MonthlyChart } from "./Charts";
import { EmptyState, MoneyBars } from "./Ledger";

export function StatsTab({ carId }: { carId: string }) {
  const t = useT();
  const unit = useStore((s) => s.prefs.unit);
  const { service, fuel, summary: s, fuelTotals: f } = useCarView(carId);
  const months = useMemo(() => monthly(service, fuel, todayISO()), [service, fuel]);
  const kinds = useMemo(() => itemKindTotals(service), [service]);

  if (!s.hasRecords) {
    return (
      <EmptyState narrow title={t.stats.emptyTitle} text={t.stats.emptyText} />
    );
  }

  const money = [
    ...(s.fuelTotal > 0 ? [{ key: "fuel", name: t.stats.fuel, sum: s.fuelTotal, fuel: true }] : []),
    ...s.categories.map((c) => ({ key: `cat:${c.name}`, name: categoryLabel(c.name), sum: c.sum })),
  ].sort((a, b) => b.sum - a.sum);
  const hasItems = kinds.some((k) => k.kind !== "none");

  return (
    <div className="stats">
      <section className="sheet stat-sheet">
        <h2 className="sheet-title">{t.stats.monthly}</h2>
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
        <div className="sheet-head">
          <h2 className="sheet-title">{t.stats.consumption(t.units.per100Long[unit])}</h2>
          {f.avg != null && <span className="muted num">{t.stats.avg(fmtConsumptionValue(f.avg))}</span>}
        </div>
        {f.points.length > 0 ? <ConsumptionChart points={f.points} avg={f.avg} /> : <p className="muted">{t.stats.needTwo}</p>}
      </section>

      <div className="stats-stack">
        <section className="sheet stat-sheet">
          <h2 className="sheet-title">{t.stats.whereMoney}</h2>
          <MoneyBars rows={money} total={s.total} />
        </section>

        {hasItems && (
          <section className="sheet stat-sheet">
            <h2 className="sheet-title">{t.stats.partsLabor}</h2>
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
      </div>
    </div>
  );
}
