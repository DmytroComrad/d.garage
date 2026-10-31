import { useEffect, useMemo, useRef, useState } from "react";
import { niceStep, type FuelPoint, type MonthRow } from "../../shared/calc";
import { MONTHS_SHORT, fmtConsumption, fmtDate, fmtDec1, fmtKm, fmtMoney0, fmtMonthKey } from "../../shared/format";

/** Ширина контейнера. Графік перемальовується при зміні вікна з затримкою 150 мс. */
const useWidth = (): [React.RefObject<HTMLDivElement | null>, number] => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setWidth(node.clientWidth), 150);
    });
    observer.observe(node);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);
  return [ref, width];
};

const axisLabel = (v: number): string => {
  if (v === 0) return "0";
  if (v >= 1000) {
    const k = v / 1000;
    return `${String(Number.isInteger(k) ? k : k.toFixed(1)).replace(".", ",")} тыс`;
  }
  return String(v);
};

const Tooltip = ({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) => {
  const flip = x > width / 2;
  return (
    <div
      className="chart-tip"
      role="status"
      style={{
        top: Math.max(0, y),
        left: flip ? undefined : x + 12,
        right: flip ? width - x + 12 : undefined,
      }}
    >
      {children}
    </div>
  );
};

/** Стовпчик із заокругленим верхом на 4 px (п. 3.8). */
const roundedTop = (x: number, y: number, w: number, h: number, r = 4): string => {
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`;
};

export function MonthlyChart({ rows }: { rows: MonthRow[] }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const height = 260;
  const m = { top: 12, right: 6, bottom: 26, left: 50 };

  const max = Math.max(...rows.map((r) => r.total), 0);
  const step = niceStep(max);
  const top = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);

  const plotW = Math.max(0, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const band = rows.length ? plotW / rows.length : 0;
  const barW = Math.min(band * 0.64, 56);
  const y = (v: number) => m.top + plotH - (v / top) * plotH;
  const everyOther = barW < 34;
  const GAP = 2;

  const active = hover != null ? rows[hover] : null;
  const summary = `Траты по месяцам: ${rows.map((r) => `${fmtMonthKey(r.key)} ${fmtMoney0(r.total)}`).join(", ")}`;

  return (
    <div ref={ref} className="chart" onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={summary}>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={m.left}
                x2={width - m.right}
                y1={y(t)}
                y2={y(t)}
                className={t === 0 ? "axis-zero" : "axis-grid"}
              />
              <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className="axis-label">
                {axisLabel(t)}
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const x = m.left + band * i + (band - barW) / 2;
            const svcH = r.service > 0 ? Math.max(1, (r.service / top) * plotH) : 0;
            const fuelH = r.fuel > 0 ? Math.max(1, (r.fuel / top) * plotH) : 0;
            const base = m.top + plotH;
            const hasBoth = svcH > 0 && fuelH > 0;
            const month = Number(r.key.slice(5, 7)) - 1;
            const showLabel = !everyOther || (rows.length - 1 - i) % 2 === 0;
            return (
              <g key={r.key} className={hover === i ? "bar is-hover" : "bar"}>
                {svcH > 0 &&
                  (fuelH > 0 ? (
                    <rect x={x} y={base - svcH} width={barW} height={svcH} className="fill-service" />
                  ) : (
                    <path d={roundedTop(x, base - svcH, barW, svcH)} className="fill-service" />
                  ))}
                {fuelH > 0 && (
                  <path
                    d={roundedTop(x, base - svcH - (hasBoth ? GAP : 0) - fuelH, barW, fuelH)}
                    className="fill-fuel"
                  />
                )}
                {showLabel && (
                  <text x={x + barW / 2} y={height - 7} textAnchor="middle" className="axis-label">
                    {MONTHS_SHORT[month]}
                  </text>
                )}
                <rect
                  x={m.left + band * i}
                  y={m.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {active && hover != null && (
        <Tooltip x={m.left + band * hover + band / 2} y={m.top + 4} width={width}>
          <strong>{fmtMonthKey(active.key)}</strong>
          <span className="tip-row">
            <i className="dot dot-service" /> Обслуживание <b>{fmtMoney0(active.service)}</b>
          </span>
          <span className="tip-row">
            <i className="dot dot-fuel" /> Топливо <b>{fmtMoney0(active.fuel)}</b>
          </span>
          <span className="tip-row tip-total">
            Всего <b>{fmtMoney0(active.total)}</b>
          </span>
        </Tooltip>
      )}
      <div className="legend">
        <span>
          <i className="dot dot-service" /> Обслуживание
        </span>
        <span>
          <i className="dot dot-fuel" /> Топливо
        </span>
      </div>
    </div>
  );
}

export function ConsumptionChart({ points, avg, height = 220 }: { points: FuelPoint[]; avg: number | null; height?: number }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 12, right: 14, bottom: 24, left: 34 };

  const { lo, hi } = useMemo(() => {
    const values = points.map((p) => p.value);
    let low = Math.max(0, Math.floor(Math.min(...values) - 0.5));
    let high = Math.ceil(Math.max(...values) + 0.5);
    if (high - low < 2) {
      high = low + 2;
    }
    low = Math.max(0, low);
    return { lo: low, hi: high };
  }, [points]);

  const plotW = Math.max(0, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const x = (i: number) => (points.length === 1 ? m.left + plotW / 2 : m.left + (plotW * i) / (points.length - 1));
  const y = (v: number) => m.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  const ticks = hi - lo <= 4 ? hi - lo : 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join("");
  const active = hover != null ? points[hover] : null;
  const summary = `Расход по заправкам: ${points.map((p) => `${fmtDate(p.date)} ${fmtConsumption(p.value)}`).join(", ")}`;

  return (
    <div ref={ref} className="chart" onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={summary}>
          {tickValues.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className="axis-grid-solid" />
              <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className="axis-label">
                {Number.isInteger(t) ? t : t.toFixed(1).replace(".", ",")}
              </text>
            </g>
          ))}
          {avg != null && <line x1={m.left} x2={width - m.right} y1={y(avg)} y2={y(avg)} className="line-avg" />}
          <path d={path} className="line-fuel" />
          {points.map((p, i) => (
            <circle key={p.id} cx={x(i)} cy={y(p.value)} r={4.5} className={`marker${hover === i ? " is-hover" : ""}`} />
          ))}
          <text x={m.left} y={height - 6} className="axis-label">
            {fmtDate(points[0]?.date)}
          </text>
          {points.length > 1 && (
            <text x={width - m.right} y={height - 6} textAnchor="end" className="axis-label">
              {fmtDate(points[points.length - 1]?.date)}
            </text>
          )}
          {points.map((p, i) => {
            const cell = points.length === 1 ? plotW : plotW / (points.length - 1);
            return (
              <rect
                key={p.id}
                x={x(i) - cell / 2}
                y={m.top}
                width={cell}
                height={plotH}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
              />
            );
          })}
        </svg>
      )}
      {active && hover != null && (
        <Tooltip x={x(hover)} y={Math.max(0, y(active.value) - 54)} width={width}>
          <strong>
            {fmtDate(active.date)}
            {active.station ? ` · ${active.station}` : ""}
          </strong>
          <span>
            {fmtDec1(active.value)}&nbsp;л/100 км · {fmtKm(active.odo)}
          </span>
        </Tooltip>
      )}
    </div>
  );
}
