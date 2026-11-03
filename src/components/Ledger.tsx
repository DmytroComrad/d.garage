import { useCallback, useMemo, useState, type ReactNode } from "react";
import { fmtMoney0, fmtMonthKey } from "../../shared/format";
import type { Photo } from "../../shared/types";
import { photoUrl } from "../lib/photos";
import { openDialog, useT } from "../lib/store";
import { CheckIcon, PumpIcon, TrashIcon, WrenchIcon } from "./icons";
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

export type MoneyBar = { key: string; name: string; sum: number; fuel?: boolean };

/** Смужки «назва, сума, частка». Ширина рахується від найбільшої, частка — від `total`. */
export const MoneyBars = ({ rows, total }: { rows: MoneyBar[]; total: number }) => {
  const top = Math.max(...rows.map((r) => r.sum), 0);
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.key}>
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
  const t = useT();
  if (!photos.length) return null;
  return (
    <div className="rec-photos">
      {photos.map((p, i) => (
        <button
          key={p.id}
          type="button"
          className="rec-photo"
          aria-label={t.gallery.openPhoto(p.name)}
          onClick={() => openDialog({ type: "lightbox", photos, index: i })}
        >
          <img src={photoUrl(p, "thumb")} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  );
};

/** Режим вибору: рядок стає галочкою, а не відкриває запис. */
export type RowSelect = { checked: boolean; onToggle: (id: string) => void };

/** Рядок журналу. Вміст під ним (розбивка затрат) передається через children. */
export const LedgerRow = ({
  id,
  kind,
  title,
  meta,
  sum,
  badge,
  photos,
  onOpen,
  select,
  stale,
  children,
}: {
  id: string;
  kind: "service" | "fuel";
  title: string;
  meta: string;
  sum: string;
  badge?: ReactNode;
  photos: Photo[];
  onOpen: () => void;
  select?: RowSelect;
  stale?: boolean;
  children?: ReactNode;
}) => (
  <article className={`rec${select?.checked ? " is-picked" : ""}${stale ? " is-stale" : ""}`}>
    <button
      type="button"
      className="rec-main"
      onClick={select ? () => select.onToggle(id) : onOpen}
      {...(select ? { role: "checkbox", "aria-checked": select.checked } : {})}
    >
      {select ? (
        <span className={`rec-icon rec-check${select.checked ? " is-on" : ""}`}>{select.checked && <CheckIcon />}</span>
      ) : (
        <span className={`rec-icon rec-icon-${kind}`}>{kind === "service" ? <WrenchIcon /> : <PumpIcon />}</span>
      )}
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

/** Вибір кількох записів для видалення. Записи, що зникли зі списку, з вибору випадають самі. */
export function useSelection(ids: string[]) {
  const [on, setOn] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const known = useMemo(() => new Set(ids), [ids]);
  const selected = useMemo(() => [...picked].filter((id) => known.has(id)), [picked, known]);

  const toggle = useCallback(
    (id: string) =>
      setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  return {
    on,
    selected,
    isPicked: (id: string) => picked.has(id),
    toggle,
    start: () => setOn(true),
    stop: () => {
      setOn(false);
      setPicked(new Set());
    },
    setAll: (all: boolean) => setPicked(all ? new Set(ids) : new Set()),
    allPicked: selected.length === ids.length && ids.length > 0,
  };
}

export type Selection = ReturnType<typeof useSelection>;

/** Кнопка над списком: вмикає вибір записів. Під час вибору замість неї — підказка. */
export function SelectToggle({ selection }: { selection: Selection }) {
  const t = useT();
  return (
    <div className="list-tools">
      {selection.on ? (
        <p className="muted">{t.select.hint}</p>
      ) : (
        <button type="button" className="btn btn-quiet btn-small" onClick={selection.start}>
          <TrashIcon size={16} /> {t.select.start}
        </button>
      )}
    </div>
  );
}

/** Панель унизу під час вибору: скільки вибрано, «вибрати все», видалення з підтвердженням. */
export function SelectBar({ selection, onDelete }: { selection: Selection; onDelete: (ids: string[]) => void }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  if (!selection.on) return null;
  const n = selection.selected.length;
  return (
    <div className="select-bar" role="region" aria-label={t.select.selected(n)}>
      {asking && n > 0 ? (
        <>
          <span className="select-question">{t.select.confirm(n)}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setAsking(false)}>
            {t.common.cancel}
          </button>
          <button
            type="button"
            className="btn btn-danger btn-small"
            onClick={() => {
              onDelete(selection.selected);
              setAsking(false);
              selection.stop();
            }}
          >
            {t.common.yesDelete}
          </button>
        </>
      ) : (
        <>
          <span className="select-count">{t.select.selected(n)}</span>
          <button type="button" className="link-btn" onClick={() => selection.setAll(!selection.allPicked)}>
            {selection.allPicked ? t.select.none : t.select.all}
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-quiet btn-small" onClick={selection.stop}>
            {t.common.cancel}
          </button>
          <button type="button" className="btn btn-danger btn-small" disabled={!n} onClick={() => setAsking(true)}>
            {t.select.delete(n)}
          </button>
        </>
      )}
    </div>
  );
}
