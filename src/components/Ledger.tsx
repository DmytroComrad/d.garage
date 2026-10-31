import type { ReactNode } from "react";
import { fmtMoney0, fmtMonthKey } from "../../shared/format";
import type { Photo } from "../../shared/types";
import { photoUrl } from "../lib/photos";
import { openDialog } from "../lib/store";
import { PumpIcon, WrenchIcon } from "./icons";
import { Mono } from "./Mono";

export const Summary = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="sheet side-sheet">
    <h2 className="sheet-title">{title}</h2>
    {children}
  </section>
);

export const KeyValue = ({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: ReactNode;
  tone?: "service" | "fuel";
  big?: boolean;
}) => (
  <div className={`kv${big ? " kv-big" : ""}${tone ? ` kv-${tone}` : ""}`}>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

export type MoneyBar = { name: string; sum: number; fuel?: boolean };

/** Смужки «назва, сума, частка». Ширина рахується від найбільшої, частка — від `total`. */
export const MoneyBars = ({ rows, total }: { rows: MoneyBar[]; total: number }) => {
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
            <div
              className={`bar-fill ${r.fuel ? "bar-fuel" : "bar-service"}`}
              style={{ width: `${top ? (r.sum / top) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
};

export const EmptyState = ({
  title,
  text,
  narrow,
  children,
}: {
  title: string;
  text: string;
  narrow?: boolean;
  children?: ReactNode;
}) => (
  <div className={`empty${narrow ? " narrow" : ""}`}>
    <h2>{title}</h2>
    <p>{text}</p>
    {children}
  </div>
);

export const groupByMonth = <T extends { date: string }>(list: T[]): [string, T[]][] => {
  const groups = new Map<string, T[]>();
  for (const r of list) {
    const key = r.date.slice(0, 7);
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.entries()];
};

export const MonthGroup = ({ monthKey, total, children }: { monthKey: string; total: string; children: ReactNode }) => (
  <section className="month">
    <header className="month-head">
      <h3>{fmtMonthKey(monthKey)}</h3>
      <span className="num">{total}</span>
    </header>
    <div className="sheet ledger">{children}</div>
  </section>
);

const RecordPhotos = ({ photos }: { photos: Photo[] }) => {
  if (!photos.length) return null;
  return (
    <div className="rec-photos">
      {photos.map((p, i) => (
        <button
          key={p.id}
          type="button"
          className="rec-photo"
          aria-label={`Открыть фото ${p.name}`}
          onClick={() => openDialog({ type: "lightbox", photos, index: i })}
        >
          <img src={photoUrl(p, "thumb")} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  );
};

/** Рядок журналу. Вміст під ним (розбивка затрат) передається через children. */
export const LedgerRow = ({
  kind,
  title,
  meta,
  sum,
  badge,
  photos,
  onOpen,
  children,
}: {
  kind: "service" | "fuel";
  title: string;
  meta: string;
  sum: string;
  badge?: ReactNode;
  photos: Photo[];
  onOpen: () => void;
  children?: ReactNode;
}) => (
  <article className="rec">
    <button type="button" className="rec-main" onClick={onOpen}>
      <span className={`rec-icon rec-icon-${kind}`}>{kind === "service" ? <WrenchIcon /> : <PumpIcon />}</span>
      <span className="rec-body">
        <span className="rec-title">{title}</span>
        <span className="rec-meta">
          <Mono text={meta} />
        </span>
      </span>
      <span className="rec-side">
        <span className="rec-sum num">{sum}</span>
        {badge}
      </span>
    </button>
    {children}
    <RecordPhotos photos={photos} />
  </article>
);
