import { memo, useId, useMemo, useState } from "react";
import { sumMoney } from "../../shared/calc";
import { ITEM_KINDS, categoryLabel, itemKindLabel } from "../../shared/constants";
import { fmtDate, fmtDist, fmtMoney, fmtMoney0, fmtPerDist, fmtTotal } from "../../shared/format";
import { EMPTY_INPUTS, filterFromInputs, filterRecords, recordMonths, sortRecords, sortsByDate } from "../../shared/listview";
import type { Photo, ServiceRecord, Wish } from "../../shared/types";
import { deleteRecords, openDialog, toast, unlinkWishes, useCarView, useStore, useT } from "../lib/store";
import { NO_PHOTOS } from "../lib/view";
import { WarnIcon } from "./icons";
import { FilterPanel, FilterResult, ListControls, hasInputs, useListView } from "./ListTools";
import {
  EmptyState,
  HeadlineMoney,
  KeyValue,
  LedgerRow,
  MoneyBars,
  MonthGroup,
  SelectBar,
  SelectToggle,
  Summary,
  groupByMonth,
  useSelection,
  type RowSelect,
} from "./Ledger";

function ItemBreakdown({ record }: { record: ServiceRecord }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!record.items.length) return null;

  const totals = ITEM_KINDS.map((kind) => {
    const items = record.items.filter((it) => it.kind === kind);
    return { kind, count: items.length, sum: sumMoney(items.map((it) => it.sum)) };
  }).filter((row) => row.count > 0);

  return (
    <div className="rec-items">
      <button type="button" className="rec-items-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {totals.map((row) => (
          <span key={row.kind} className="rec-kind">
            {itemKindLabel(row.kind)} <b>{fmtMoney0(row.sum, record.currency)}</b>
          </span>
        ))}
        <span className="rec-items-more">{open ? t.service.collapse : t.service.details}</span>
      </button>
      {open && (
        <ul className="rec-item-list">
          {record.items.map((it) => (
            <li key={it.id}>
              <span>{it.name || itemKindLabel(it.kind)}</span>
              <b>{fmtMoney(it.sum, record.currency)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ServiceRow = memo(function ServiceRow({
  record,
  photos,
  stale,
  select,
}: {
  record: ServiceRecord;
  photos: Photo[];
  stale: boolean;
  select?: RowSelect;
}) {
  const t = useT();
  const meta = [fmtDate(record.date), record.odo != null ? fmtDist(record.odo) : "", record.where, record.note];
  return (
    <LedgerRow
      id={record.id}
      kind="service"
      title={record.what || categoryLabel(record.cat)}
      meta={meta.filter(Boolean).join(" · ")}
      sum={fmtMoney(record.sum, record.currency)}
      badge={
        <>
          {stale && <span className="tag tag-bad">{t.stale.tag}</span>}
          <span className="tag">{categoryLabel(record.cat)}</span>
        </>
      }
      photos={photos}
      onOpen={() => openDialog({ type: "service", record })}
      select={select}
      stale={stale}
    >
      <ItemBreakdown record={record} />
    </LedgerRow>
  );
});

/**
 * Записи, створені з хотілок, які знову позначили невиконаними. Їх варто видалити одним натиском
 * або залишити — тоді зв'язок із хотілкою зникає і попередження теж.
 */
function StaleRecords({ records, wishes }: { records: ServiceRecord[]; wishes: Wish[] }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  if (!records.length) return null;
  const n = records.length;
  return (
    <section className="stale" role="alert">
      <div className="stale-head">
        <span className="stale-icon">
          <WarnIcon />
        </span>
        <h2 className="sheet-title">{t.stale.title(n)}</h2>
      </div>
      <p>{t.stale.text}</p>
      <ul className="stale-list">
        {records.map((r) => (
          <li key={r.id}>
            <button type="button" className="link-btn" onClick={() => openDialog({ type: "service", record: r })}>
              {r.what}
            </button>
            <span className="muted num">
              {fmtDate(r.date)} · {fmtMoney0(r.sum, r.currency)}
            </span>
          </li>
        ))}
      </ul>
      <div className="btn-row">
        {asking ? (
          <span className="confirm-inline">
            <span>{t.select.confirm(n)}</span>
            <button
              type="button"
              className="btn btn-danger btn-small"
              onClick={() => {
                deleteRecords(
                  "service",
                  records.map((r) => r.id),
                );
                toast(t.stale.deleted(n));
              }}
            >
              {t.common.yesDelete}
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-danger btn-small" onClick={() => setAsking(true)}>
            {t.stale.deleteAll(n)}
          </button>
        )}
        <button
          type="button"
          className="btn btn-quiet btn-small"
          onClick={() => {
            unlinkWishes(wishes);
            toast(t.stale.kept);
          }}
        >
          {t.stale.keep}
        </button>
      </div>
    </section>
  );
}

export function ServiceTab({ carId }: { carId: string }) {
  const t = useT();
  const unit = useStore((s) => s.prefs.unit);
  const { service, photosByRecord, summary: s, totals, second, money, staleRecords } = useCarView(carId);
  const [view, setView] = useListView("service");
  const panelId = useId();
  const stale = useMemo(() => sortRecords(service, "new").filter((r) => staleRecords.has(r.id)), [service, staleRecords]);
  const months = useMemo(() => recordMonths(service), [service]);
  const shown = useMemo(
    () => sortRecords(filterRecords(service, filterFromInputs(view.inputs, unit)), view.sort, money.sumOf),
    [service, view.inputs, view.sort, unit, money],
  );
  const selection = useSelection(shown.map((r) => r.id));
  const row = (r: ServiceRecord) => (
    <ServiceRow
      key={r.id}
      record={r}
      photos={photosByRecord.get(r.id) ?? NO_PHOTOS}
      stale={staleRecords.has(r.id)}
      select={selection.on ? { checked: selection.isPicked(r.id), onToggle: selection.toggle } : undefined}
    />
  );

  return (
    <div className="columns">
      <aside className="side">
        <Summary title={t.service.summary}>
          <dl className="kvs">
            <KeyValue
              label={t.service.totalIn}
              value={<HeadlineMoney total={totals.all} second={second} />}
              big
              tone="service"
            />
            <KeyValue label={t.service.serviceAndPurchases} value={fmtTotal(totals.service)} />
            <KeyValue label={t.service.fuel} value={fmtTotal(totals.fuel)} />
            <KeyValue label={t.service.thisYear} value={fmtTotal(totals.thisYear)} />
            <hr />
            <KeyValue label={t.service.currentOdo} value={fmtDist(s.currentOdo)} />
            <KeyValue label={t.service.since} value={fmtDate(s.since)} />
            <KeyValue label={t.service.startOdo} value={fmtDist(s.startOdo)} />
            <KeyValue label={t.service.driven} value={fmtDist(s.driven)} />
            <KeyValue label={t.hero.perDist[unit]} value={fmtPerDist(s.perKm)} />
            <hr />
            <KeyValue label={t.service.lastService} value={fmtDate(s.lastService?.date)} />
            <KeyValue label={t.service.atOdo} value={fmtDist(s.lastService?.odo)} />
            <KeyValue label={t.service.what} value={<span className="kv-text">{s.lastService?.what ?? "—"}</span>} />
          </dl>
        </Summary>
        {s.categories.length > 0 && (
          <Summary title={t.service.byCategory}>
            <MoneyBars
              rows={s.categories.map((c) => ({ key: c.name, name: categoryLabel(c.name), sum: c.sum }))}
              total={s.serviceTotal}
            />
          </Summary>
        )}
      </aside>

      <div className="list">
        <StaleRecords records={stale} wishes={stale.map((r) => staleRecords.get(r.id)).filter((w): w is Wish => !!w)} />
        {service.length === 0 ? (
          <EmptyState title={t.service.emptyTitle} text={t.service.emptyText}>
            <button type="button" className="btn btn-service" onClick={() => openDialog({ type: "service", car: carId })}>
              {t.service.first}
            </button>
          </EmptyState>
        ) : (
          <>
            <SelectToggle selection={selection}>
              <ListControls view={view} onChange={setView} panelId={panelId} />
            </SelectToggle>
            {view.open && (
              <FilterPanel
                id={panelId}
                inputs={view.inputs}
                months={months}
                onChange={(inputs) => setView({ inputs })}
                onClose={() => setView({ open: false })}
              />
            )}
            {hasInputs(view.inputs) && (
              <FilterResult
                shown={shown.length}
                total={service.length}
                sum={fmtTotal(money.total(shown))}
                onReset={() => setView({ inputs: EMPTY_INPUTS })}
              />
            )}
            {shown.length === 0 ? (
              <EmptyState title={t.list.nothingTitle} text={t.list.nothingText} />
            ) : sortsByDate(view.sort) ? (
              groupByMonth(shown).map(([key, records]) => (
                <MonthGroup key={key} monthKey={key} total={fmtTotal(money.total(records))}>
                  {records.map(row)}
                </MonthGroup>
              ))
            ) : (
              <div className="sheet ledger">{shown.map(row)}</div>
            )}
            <SelectBar
              selection={selection}
              onDelete={(ids) => {
                deleteRecords("service", ids);
                toast(t.select.deleted(ids.length));
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
