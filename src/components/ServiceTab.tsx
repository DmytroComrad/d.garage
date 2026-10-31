import { useState } from "react";
import { sumMoney, carSummary } from "../../shared/calc";
import { itemKindLabel } from "../../shared/constants";
import { fmtDate, fmtKm, fmtMoney, fmtMoney0, fmtMonthKey, todayISO } from "../../shared/format";
import type { ItemKind, Photo, ServiceRecord } from "../../shared/types";
import { photoUrl } from "../lib/photos";
import { carRecords, openDialog, useApp } from "../lib/store";
import { WrenchIcon } from "./icons";
import { Mono } from "./Mono";

export const Summary = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="sheet side-sheet">
    <h2 className="sheet-title">{title}</h2>
    {children}
  </section>
);

export const Row = ({ label, value, tone, big }: { label: string; value: React.ReactNode; tone?: "service" | "fuel"; big?: boolean }) => (
  <div className={`kv${big ? " kv-big" : ""}${tone ? ` kv-${tone}` : ""}`}>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

export const groupByMonth = <T extends { date: string }>(list: T[]): [string, T[]][] => {
  const groups = new Map<string, T[]>();
  for (const r of list) {
    const key = r.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()];
};

export function RecordPhotos({ photos }: { photos: Photo[] }) {
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
}

function ItemBreakdown({ record }: { record: ServiceRecord }) {
  const [open, setOpen] = useState(false);
  if (!record.items.length) return null;

  const kinds: ItemKind[] = ["parts", "labor", "extra"];
  const totals = kinds
    .map((kind) => ({
      kind,
      sum: sumMoney(record.items.filter((it) => it.kind === kind).map((it) => it.sum)),
      count: record.items.filter((it) => it.kind === kind).length,
    }))
    .filter((row) => row.count > 0);

  return (
    <div className="rec-items">
      <button type="button" className="rec-items-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {totals.map((t) => (
          <span key={t.kind} className="rec-kind">
            {itemKindLabel(t.kind)} <b>{fmtMoney0(t.sum)}</b>
          </span>
        ))}
        <span className="rec-items-more">{open ? "Свернуть" : "Подробнее"}</span>
      </button>
      {open && (
        <ul className="rec-item-list">
          {record.items.map((it) => (
            <li key={it.id}>
              <span>{it.name || itemKindLabel(it.kind)}</span>
              <b>{fmtMoney(it.sum)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ServiceTab({ carId }: { carId: string }) {
  const { data } = useApp();
  const { service, fuel, photos } = carRecords(data, carId);
  const s = carSummary(service, fuel, todayISO());
  const sorted = [...service].sort((a, b) => b.date.localeCompare(a.date) || (b.odo ?? -1) - (a.odo ?? -1));
  const top = s.categories[0]?.sum ?? 0;

  return (
    <div className="columns">
      <aside className="side">
        <Summary title="Сводка">
          <dl className="kvs">
            <Row label="Вложено в машину" value={fmtMoney0(s.total)} big tone="service" />
            <Row label="Обслуживание и покупки" value={fmtMoney0(s.serviceTotal)} />
            <Row label="Топливо" value={fmtMoney0(s.fuelTotal)} />
            <Row label="В этом году" value={fmtMoney0(s.thisYear)} />
            <hr />
            <Row label="Текущий пробег" value={fmtKm(s.currentOdo)} />
            <Row label="Учёт с" value={fmtDate(s.since)} />
            <Row label="Пробег в начале учёта" value={fmtKm(s.startOdo)} />
            <Row label="Проехано" value={fmtKm(s.driven)} />
            <Row label="1 км обходится" value={fmtMoney(s.perKm)} />
            <hr />
            <Row label="Последнее обслуживание" value={fmtDate(s.lastService?.date)} />
            <Row label="На пробеге" value={fmtKm(s.lastService?.odo)} />
            <Row label="Что делали" value={<span className="kv-text">{s.lastService?.what ?? "—"}</span>} />
          </dl>
        </Summary>
        {s.categories.length > 0 && (
          <Summary title="По категориям">
            <ul className="bars">
              {s.categories.map((c) => (
                <li key={c.name}>
                  <div className="bars-head">
                    <span>{c.name}</span>
                    <span className="num">
                      {fmtMoney0(c.sum)} · {Math.round(c.share)}%
                    </span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill bar-service" style={{ width: `${top ? (c.sum / top) * 100 : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Summary>
        )}
      </aside>

      <div className="list">
        {sorted.length === 0 ? (
          <div className="empty">
            <h2>Ремонтов и покупок пока нет</h2>
            <p>Записывай всё, что вкладываешь в машину: ремонт, ТО, запчасти, мойку, страховку.</p>
            <button type="button" className="btn btn-service" onClick={() => openDialog({ type: "service", car: carId })}>
              Первая запись
            </button>
          </div>
        ) : (
          groupByMonth(sorted).map(([key, records]) => (
            <section key={key} className="month">
              <header className="month-head">
                <h3>{fmtMonthKey(key)}</h3>
                <span className="num">{fmtMoney0(sumMoney(records.map((r) => r.sum)))}</span>
              </header>
              <div className="sheet ledger">
                {records.map((r) => {
                  const meta = [fmtDate(r.date), r.odo != null ? fmtKm(r.odo) : "", r.where, r.note].filter(Boolean);
                  return (
                    <article key={r.id} className="rec">
                      <button type="button" className="rec-main" onClick={() => openDialog({ type: "service", record: r })}>
                        <span className="rec-icon rec-icon-service">
                          <WrenchIcon />
                        </span>
                        <span className="rec-body">
                          <span className="rec-title">{r.what || r.cat}</span>
                          <span className="rec-meta"><Mono text={meta.join(" · ")} /></span>
                        </span>
                        <span className="rec-side">
                          <span className="rec-sum num">{fmtMoney(r.sum)}</span>
                          <span className="tag">{r.cat}</span>
                        </span>
                      </button>
                      <ItemBreakdown record={r} />
                      <RecordPhotos photos={photos.filter((p) => p.recordId === r.id)} />
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
