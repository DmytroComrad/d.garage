import { useId, useState, type FormEvent } from "react";
import { sumMoney } from "../../../shared/calc";
import { CATEGORIES, DEFAULT_CATEGORY, ITEM_KINDS, LIMITS, WISH_CATEGORY, categoryLabel, itemKindLabel } from "../../../shared/constants";
import { CURRENCY_SYMBOLS, type Currency } from "../../../shared/currency";
import { fmtDist, fmtMoney, fmtNum, genId, numInput, todayISO, unitLabel } from "../../../shared/format";
import { parseMoney, parseOdo } from "../../../shared/parse";
import { fromKm, toKm } from "../../../shared/prefs";
import type { ItemKind, Op, ServiceRecord } from "../../../shared/types";
import { closeDialog, deleteRecordsOps, dispatch, getState, toast, useStore, useT, type ServiceDraft } from "../../lib/store";
import { CloseIcon, PlusIcon } from "../icons";
import { Modal } from "../Modal";
import {
  CarSelect,
  Field,
  FormFooter,
  MoneyInput,
  Suggest,
  carOdo,
  finishSave,
  reminderForRecord,
  reminderOps,
  useLinkedReminder,
  usePrevOdo,
  useMainCurrency,
  useReminderDraft,
} from "./common";
import { PhotoField } from "./PhotoField";
import { ReminderFields } from "./ReminderFields";

type ItemDraft = { id: string; kind: ItemKind; name: string; sum: string };

const itemSum = (raw: string): number | null => {
  const value = parseMoney(raw);
  return typeof value === "number" && value <= LIMITS.maxSum ? value : null;
};

/**
 * Запис обслуговування. `draft` і `wishId` приходять, коли запис створюють із виконаної хотілки:
 * опис і ціна підставлені, а після збереження хотілка посилатиметься на цей запис.
 */
export function ServiceForm({
  record,
  car: carProp,
  draft,
  wishId,
}: {
  record?: ServiceRecord;
  car?: string;
  draft?: ServiceDraft;
  wishId?: string;
}) {
  const t = useT();
  const active = useStore((s) => s.active);
  const cars = useStore((s) => s.data.cars);
  const allService = useStore((s) => s.data.service);
  const photos = useStore((s) => s.data.photos);

  const [car, setCar] = useState(record?.car ?? carProp ?? active ?? cars[0]?.id ?? "");
  const [date, setDate] = useState(record?.date ?? todayISO());
  const [odo, setOdo] = useState(record?.odo != null ? String(fromKm(record.odo)) : "");
  const [cat, setCat] = useState<string>(record?.cat ?? (draft ? WISH_CATEGORY : DEFAULT_CATEGORY));
  const [what, setWhat] = useState(record?.what ?? draft?.what ?? "");
  const [where, setWhere] = useState(record?.where ?? "");
  const [sum, setSum] = useState(record ? numInput(record.sum) : draft?.sum != null ? numInput(draft.sum) : "");
  const main = useMainCurrency();
  // Суми позицій — у валюті запису.
  const [currency, setCurrency] = useState<Currency>(record?.currency ?? draft?.currency ?? main);
  const symbol = CURRENCY_SYMBOLS[currency];
  const [note, setNote] = useState(record?.note ?? draft?.note ?? "");
  const [items, setItems] = useState<ItemDraft[]>(
    (record?.items ?? []).map((it) => ({ ...it, sum: numInput(it.sum) })),
  );
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const prev = usePrevOdo(car, record?.id);
  const parsedOdo = parseOdo(odo);
  const odoKm = typeof parsedOdo === "number" ? toKm(parsedOdo) : null;
  const baseOdo = odoKm ?? prev ?? carOdo(car);
  const linked = useLinkedReminder(record?.id);
  const [reminder, setReminder] = useReminderDraft(linked, record?.odo ?? carOdo(record?.car ?? ""));

  const baseId = useId();
  const whereId = `${baseId}-where`;
  const namesId = `${baseId}-names`;
  const sumId = `${baseId}-sum`;
  const catId = `${baseId}-cat`;

  const itemsTotal = sumMoney(items.map((it) => itemSum(it.sum) ?? 0));
  const typed = parseMoney(sum);
  const leftover = items.length && typeof typed === "number" ? sumMoney([typed, -itemsTotal]) : 0;
  const existing = record ? photos.filter((p) => p.recordId === record.id) : [];

  const addItem = (kind: ItemKind, preset = "") =>
    setItems((list) => [...list, { id: genId(), kind, name: "", sum: preset }]);
  const patchItem = (id: string, patch: Partial<ItemDraft>) =>
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!date) return setError(t.serviceForm.errDate);
    if (parsedOdo === "invalid") return setError(t.serviceForm.errOdo);
    if (!what.trim()) return setError(t.serviceForm.errWhat);

    let total: number;
    if (items.length) {
      if (items.some((it) => itemSum(it.sum) == null)) return setError(t.serviceForm.errItemSum);
      total = itemsTotal;
    } else {
      if (typeof typed !== "number" || typed > LIMITS.maxSum) return setError(t.serviceForm.errSum);
      total = typed;
    }

    const id = record?.id ?? genId();
    const built = reminderForRecord(reminder, {
      car,
      recordId: id,
      baseOdo,
      fallbackTitle: what.trim(),
      linked,
    });
    if ("error" in built) return setError(built.error);

    const next: ServiceRecord = {
      id,
      car,
      date,
      odo: odoKm,
      cat,
      what: what.trim(),
      where: where.trim(),
      sum: total,
      currency,
      note: note.trim(),
      items: items.map((it) => ({ id: it.id, kind: it.kind, name: it.name.trim(), sum: itemSum(it.sum) ?? 0 })),
    };
    const ops: Op[] = [{ type: "service.put", data: next }, ...reminderOps(built.reminder, linked)];
    const wish = wishId ? getState().data.wishes.find((w) => w.id === wishId) : undefined;
    if (wish) {
      ops.push({
        type: "wish.put",
        data: { ...wish, done: true, doneDate: wish.doneDate ?? date, recordId: id },
      });
    }
    dispatch(...ops);
    finishSave(car, !record, files, id);
  };

  const remove = () => {
    if (!record) return;
    dispatch(...deleteRecordsOps("service", [record.id]));
    closeDialog();
    toast(t.common.recordDeleted);
  };

  const ids: string[] = CATEGORIES.map((c) => c.id);
  const categories = ids.includes(cat) ? ids : [...ids, cat];
  const unit = unitLabel();

  return (
    <Modal title={record ? t.serviceForm.titleEdit : t.serviceForm.titleNew} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <CarSelect value={car} onChange={setCar} />
        <div className="field-row">
          <Field label={t.serviceForm.date}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t.serviceForm.odo(unit)} hint={prev != null ? t.serviceForm.prev(fmtDist(prev)) : t.common.optional}>
            <input
              inputMode="numeric"
              value={odo}
              onChange={(e) => setOdo(e.target.value)}
              placeholder={prev != null ? fmtNum(fromKm(prev)) : ""}
            />
          </Field>
        </div>
        <div className="field">
          <span className="field-label" id={catId}>
            {t.serviceForm.category}
          </span>
          <div className="chip-grid" role="group" aria-labelledby={catId}>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`pick${c === cat ? " is-on" : ""}`}
                aria-pressed={c === cat}
                onClick={() => setCat(c)}
              >
                {categoryLabel(c)}
              </button>
            ))}
          </div>
        </div>
        <Field label={t.serviceForm.what}>
          <textarea rows={2} value={what} onChange={(e) => setWhat(e.target.value)} maxLength={LIMITS.whatLength} />
        </Field>
        <Field label={t.serviceForm.where}>
          <input value={where} onChange={(e) => setWhere(e.target.value)} list={whereId} maxLength={LIMITS.placeLength} />
        </Field>
        <Suggest id={whereId} values={allService.map((r) => r.where)} />

        <div className="field">
          <label className="field-label" htmlFor={sumId}>
            {t.serviceForm.sum(symbol)}
          </label>
          <MoneyInput currency={currency} onCurrency={setCurrency}>
            {items.length ? (
              <output id={sumId} className="sum-total">
                {fmtMoney(itemsTotal, currency)}
              </output>
            ) : (
              <input id={sumId} inputMode="decimal" value={sum} onChange={(e) => setSum(e.target.value)} />
            )}
          </MoneyInput>
        </div>

        <div className="items">
          {items.length > 0 && (
            <ul className="item-list">
              {items.map((it) => (
                <li key={it.id} className="item-row">
                  <select
                    aria-label={t.serviceForm.kindAria}
                    value={it.kind}
                    onChange={(e) => patchItem(it.id, { kind: e.target.value as ItemKind })}
                  >
                    {ITEM_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {itemKindLabel(k)}
                      </option>
                    ))}
                  </select>
                  <input
                    className="item-name"
                    aria-label={t.serviceForm.nameAria}
                    value={it.name}
                    placeholder={t.itemKinds[it.kind].placeholder}
                    list={namesId}
                    maxLength={LIMITS.itemNameLength}
                    onChange={(e) => patchItem(it.id, { name: e.target.value })}
                  />
                  <input
                    className="item-sum"
                    aria-label={t.serviceForm.sumAria(symbol)}
                    inputMode="decimal"
                    placeholder={symbol}
                    value={it.sum}
                    onChange={(e) => patchItem(it.id, { sum: e.target.value })}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t.serviceForm.removeRow}
                    onClick={() => setItems((list) => list.filter((x) => x.id !== it.id))}
                  >
                    <CloseIcon size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Suggest id={namesId} values={allService.flatMap((r) => r.items.map((i) => i.name))} />
          {items.length < LIMITS.itemsPerRecord && (
            <div className="item-add">
              <span className="muted">{items.length ? t.serviceForm.moreRow : t.serviceForm.split}</span>
              {ITEM_KINDS.map((k) => (
                <button key={k} type="button" className="preset" onClick={() => addItem(k)}>
                  <PlusIcon size={14} /> {itemKindLabel(k).toLocaleLowerCase()}
                </button>
              ))}
            </div>
          )}
          {leftover > 0 && (
            <p className="field-hint">
              {t.serviceForm.leftover(fmtMoney(typed as number, currency), fmtMoney(leftover, currency))}{" "}
              <button type="button" className="link-btn" onClick={() => addItem("extra", numInput(leftover))}>
                {t.serviceForm.addOther}
              </button>
            </p>
          )}
        </div>

        <Field label={t.serviceForm.notes}>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.noteLength} />
        </Field>
        <ReminderFields draft={reminder} onChange={setReminder} baseOdo={baseOdo} baseDate={date} />
        <PhotoField existing={existing} pending={files} onPending={setFiles} />
        <FormFooter error={error} onDelete={record ? remove : undefined} />
      </form>
    </Modal>
  );
}
