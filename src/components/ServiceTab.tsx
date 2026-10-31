import { memo, useState } from "react";
import { sumMoney } from "../../shared/calc";
import { itemKindLabel } from "../../shared/constants";
import { fmtDate, fmtKm, fmtMoney, fmtMoney0 } from "../../shared/format";
import type { ItemKind, Photo, ServiceRecord } from "../../shared/types";
import { openDialog, useCarView } from "../lib/store";
import { NO_PHOTOS } from "../lib/view";
import { EmptyState, KeyValue, LedgerRow, MoneyBars, MonthGroup, Summary, groupByMonth } from "./Ledger";

const KINDS: ItemKind[] = ["parts", "labor", "extra"];

function ItemBreakdown({ record }: { record: ServiceRecord }) {
  const [open, setOpen] = useState(false);
  if (!record.items.length) return null;

  const totals = KINDS.map((kind) => {
    const items = record.items.filter((it) => it.kind === kind);
    return { kind, count: items.length, sum: sumMoney(items.map((it) => it.sum)) };
  }).filter((row) => row.count > 0);

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

const ServiceRow = memo(function ServiceRow({ record, photos }: { record: ServiceRecord; photos: Photo[] }) {
  const meta = [fmtDate(record.date), record.odo != null ? fmtKm(record.odo) : "", record.where, record.note];
  return (
    <LedgerRow
      kind="service"
      title={record.what || record.cat}
      meta={meta.filter(Boolean).join(" · ")}
      sum={fmtMoney(record.sum)}
      badge={<span className="tag">{record.cat}</span>}
      photos={photos}
      onOpen={() => openDialog({ type: "service", record })}
    >
      <ItemBreakdown record={record} />
    </LedgerRow>
  );
});

export function ServiceTab({ carId }: { carId: string }) {
  const { service, photosByRecord, summary: s } = useCarView(carId);
  const sorted = [...service].sort((a, b) => b.date.localeCompare(a.date) || (b.odo ?? -1) - (a.odo ?? -1));

  return (
    <div className="columns">
      <aside className="side">
        <Summary title="Сводка">
          <dl className="kvs">
            <KeyValue label="Вложено в машину" value={fmtMoney0(s.total)} big tone="service" />
            <KeyValue label="Обслуживание и покупки" value={fmtMoney0(s.serviceTotal)} />
            <KeyValue label="Топливо" value={fmtMoney0(s.fuelTotal)} />
            <KeyValue label="В этом году" value={fmtMoney0(s.thisYear)} />
            <hr />
            <KeyValue label="Текущий пробег" value={fmtKm(s.currentOdo)} />
            <KeyValue label="Учёт с" value={fmtDate(s.since)} />
            <KeyValue label="Пробег в начале учёта" value={fmtKm(s.startOdo)} />
            <KeyValue label="Проехано" value={fmtKm(s.driven)} />
            <KeyValue label="1 км обходится" value={fmtMoney(s.perKm)} />
            <hr />
            <KeyValue label="Последнее обслуживание" value={fmtDate(s.lastService?.date)} />
            <KeyValue label="На пробеге" value={fmtKm(s.lastService?.odo)} />
            <KeyValue label="Что делали" value={<span className="kv-text">{s.lastService?.what ?? "—"}</span>} />
          </dl>
        </Summary>
        {s.categories.length > 0 && (
          <Summary title="По категориям">
            <MoneyBars rows={s.categories} total={s.serviceTotal} />
          </Summary>
        )}
      </aside>

      <div className="list">
        {sorted.length === 0 ? (
          <EmptyState
            title="Ремонтов и покупок пока нет"
            text="Записывай всё, что вкладываешь в машину: ремонт, ТО, запчасти, мойку, страховку."
          >
            <button type="button" className="btn btn-service" onClick={() => openDialog({ type: "service", car: carId })}>
              Первая запись
            </button>
          </EmptyState>
        ) : (
          groupByMonth(sorted).map(([key, records]) => (
            <MonthGroup key={key} monthKey={key} total={fmtMoney0(sumMoney(records.map((r) => r.sum)))}>
              {records.map((r) => (
                <ServiceRow key={r.id} record={r} photos={photosByRecord.get(r.id) ?? NO_PHOTOS} />
              ))}
            </MonthGroup>
          ))
        )}
      </div>
    </div>
  );
}
