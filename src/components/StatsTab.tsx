import { carSummary, fuelSummary, itemKindTotals, monthly } from "../../shared/calc";
import { itemKindLabel } from "../../shared/constants";
import { fmtDec1, fmtLiters1, fmtMoney0, fmtMonthKey, todayISO } from "../../shared/format";
import { carRecords, useApp } from "../lib/store";
import { ConsumptionChart, MonthlyChart } from "./Charts";

const MoneyBars = ({
  rows,
  total,
}: {
  rows: { name: string; sum: number; fuel?: boolean }[];
  total: number;
}) => {
  const top = Math.max(...rows.map((r) => r.sum), 0);
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.name}>
          <div className="bars-head">
            <span>{r.name}</span>
            <span className="num">
              {fmtMoney0(r.sum)} · {total > 0 ? Math.round((r.sum / total) * 100) : 0}%
            </span>
          </div>
          <div className="bar-track">
            <div className={`bar-fill ${r.fuel ? "bar-fuel" : "bar-service"}`} style={{ width: `${top ? (r.sum / top) * 100 : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
};

export function StatsTab({ carId }: { carId: string }) {
  const { data } = useApp();
  const { service, fuel } = carRecords(data, carId);
  const today = todayISO();
  const s = carSummary(service, fuel, today);
  const f = fuelSummary(fuel);

  if (!s.hasRecords) {
    return (
      <div className="empty narrow">
        <h2>Статистике пока не из чего строиться</h2>
        <p>Добавь пару заправок и ремонтов — здесь появятся траты по месяцам и график расхода.</p>
      </div>
    );
  }

  const months = monthly(service, fuel, today);
  const money = [
    ...(s.fuelTotal > 0 ? [{ name: "Топливо", sum: s.fuelTotal, fuel: true }] : []),
    ...s.categories.map((c) => ({ name: c.name, sum: c.sum })),
  ].sort((a, b) => b.sum - a.sum);
  const kinds = itemKindTotals(service);
  const hasItems = kinds.some((k) => k.kind !== "none");

  return (
    <div className="stats">
      <section className="sheet stat-sheet">
        <h2 className="sheet-title">Траты по месяцам</h2>
        <MonthlyChart rows={months} />
        <details className="chart-table">
          <summary>Таблица</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Месяц</th>
                  <th scope="col">Обслуживание</th>
                  <th scope="col">Топливо</th>
                  <th scope="col">Всего</th>
                  <th scope="col">Литров</th>
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
          <h2 className="sheet-title">Расход, л/100 км</h2>
          {f.avg != null && <span className="muted num">среднее {fmtDec1(f.avg)}</span>}
        </div>
        {f.points.length > 0 ? (
          <ConsumptionChart points={f.points} avg={f.avg} />
        ) : (
          <p className="muted">Нужно минимум две заправки «до полного».</p>
        )}
      </section>

      <div className="stats-stack">
        <section className="sheet stat-sheet">
          <h2 className="sheet-title">Куда уходят деньги</h2>
          <MoneyBars rows={money} total={s.total} />
        </section>

        {hasItems && (
          <section className="sheet stat-sheet">
            <h2 className="sheet-title">Запчасти и работа</h2>
            <MoneyBars
              rows={kinds.map((k) => ({
                name: k.kind === "none" ? "Без разбивки" : itemKindLabel(k.kind),
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
