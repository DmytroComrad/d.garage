import { useId, useState, type FormEvent } from "react";
import { sumMoney } from "../../../shared/calc";
import { CATEGORIES, ITEM_KINDS, LIMITS } from "../../../shared/constants";
import { fmtKm, fmtMoney, fmtNum, genId, todayISO } from "../../../shared/format";
import { parseMoney, parseOdo } from "../../../shared/parse";
import type { ItemKind, Op, ServiceRecord } from "../../../shared/types";
import { closeDialog, dispatch, toast, useStore } from "../../lib/store";
import { CloseIcon, PlusIcon } from "../icons";
import { Modal } from "../Modal";
import {
  CarSelect,
  Field,
  FormFooter,
  Suggest,
  carOdo,
  finishSave,
  reminderForRecord,
  reminderOps,
  useLinkedReminder,
  usePrevOdo,
  useReminderDraft,
} from "./common";
import { PhotoField } from "./PhotoField";
import { ReminderFields } from "./ReminderFields";

type ItemDraft = { id: string; kind: ItemKind; name: string; sum: string };

const itemSum = (raw: string): number | null => {
  const value = parseMoney(raw);
  return typeof value === "number" && value <= LIMITS.maxSum ? value : null;
};

export function ServiceForm({ record, car: carProp }: { record?: ServiceRecord; car?: string }) {
  const active = useStore((s) => s.active);
  const cars = useStore((s) => s.data.cars);
  const allService = useStore((s) => s.data.service);
  const photos = useStore((s) => s.data.photos);

  const [car, setCar] = useState(record?.car ?? carProp ?? active ?? cars[0]?.id ?? "");
  const [date, setDate] = useState(record?.date ?? todayISO());
  const [odo, setOdo] = useState(record?.odo != null ? String(record.odo) : "");
  const [cat, setCat] = useState<string>(record?.cat ?? CATEGORIES[0]);
  const [what, setWhat] = useState(record?.what ?? "");
  const [where, setWhere] = useState(record?.where ?? "");
  const [sum, setSum] = useState(record ? String(record.sum).replace(".", ",") : "");
  const [note, setNote] = useState(record?.note ?? "");
  const [items, setItems] = useState<ItemDraft[]>(
    (record?.items ?? []).map((it) => ({ ...it, sum: String(it.sum).replace(".", ",") })),
  );
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const prev = usePrevOdo(car, record?.id);
  const parsedOdo = parseOdo(odo);
  const baseOdo = typeof parsedOdo === "number" ? parsedOdo : (prev ?? carOdo(car));
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
    if (!date) return setError("Укажи дату.");
    if (parsedOdo === "invalid") return setError("Пробег — только цифры.");
    if (!what.trim()) return setError("Напиши, что сделано или куплено.");

    let total: number;
    if (items.length) {
      if (items.some((it) => itemSum(it.sum) == null)) return setError("Укажи сумму в каждой строке расходов.");
      total = itemsTotal;
    } else {
      if (typeof typed !== "number" || typed > LIMITS.maxSum) return setError("Укажи сумму (0, если бесплатно).");
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
      odo: typeof parsedOdo === "number" ? parsedOdo : null,
      cat,
      what: what.trim(),
      where: where.trim(),
      sum: total,
      note: note.trim(),
      items: items.map((it) => ({ id: it.id, kind: it.kind, name: it.name.trim(), sum: itemSum(it.sum) ?? 0 })),
    };
    dispatch({ type: "service.put", data: next }, ...reminderOps(built.reminder, linked));
    finishSave(car, !record, files, id);
  };

  const remove = () => {
    if (!record) return;
    const ops: Op[] = [{ type: "service.del", id: record.id }];
    if (linked) ops.push({ type: "reminder.del", id: linked.id });
    dispatch(...ops);
    closeDialog();
    toast("Запись удалена");
  };

  const categories: string[] = (CATEGORIES as readonly string[]).includes(cat) ? [...CATEGORIES] : [...CATEGORIES, cat];

  return (
    <Modal title={record ? "Запись" : "Ремонт, покупка, сервис"} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <CarSelect value={car} onChange={setCar} />
        <div className="field-row">
          <Field label="Дата">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Пробег, км" hint={prev != null ? `Прошлый: ${fmtKm(prev)}` : "Можно не указывать"}>
            <input
              inputMode="numeric"
              value={odo}
              onChange={(e) => setOdo(e.target.value)}
              placeholder={prev != null ? fmtNum(prev) : ""}
            />
          </Field>
        </div>
        <div className="field">
          <span className="field-label" id={catId}>
            Категория
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
                {c}
              </button>
            ))}
          </div>
        </div>
        <Field label="Что сделано / куплено">
          <textarea rows={2} value={what} onChange={(e) => setWhat(e.target.value)} maxLength={LIMITS.whatLength} />
        </Field>
        <Field label="Где">
          <input value={where} onChange={(e) => setWhere(e.target.value)} list={whereId} maxLength={LIMITS.placeLength} />
        </Field>
        <Suggest id={whereId} values={allService.map((r) => r.where)} />

        <div className="field">
          <label className="field-label" htmlFor={sumId}>
            Сумма ₴
          </label>
          {items.length ? (
            <output id={sumId} className="sum-total">
              {fmtMoney(itemsTotal)}
            </output>
          ) : (
            <input id={sumId} inputMode="decimal" value={sum} onChange={(e) => setSum(e.target.value)} />
          )}
        </div>

        <div className="items">
          {items.length > 0 && (
            <ul className="item-list">
              {items.map((it) => (
                <li key={it.id} className="item-row">
                  <select
                    aria-label="Тип расхода"
                    value={it.kind}
                    onChange={(e) => patchItem(it.id, { kind: e.target.value as ItemKind })}
                  >
                    {ITEM_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="item-name"
                    aria-label="Название"
                    value={it.name}
                    placeholder={ITEM_KINDS.find((k) => k.value === it.kind)?.placeholder}
                    list={namesId}
                    maxLength={LIMITS.itemNameLength}
                    onChange={(e) => patchItem(it.id, { name: e.target.value })}
                  />
                  <input
                    className="item-sum"
                    aria-label="Сумма, ₴"
                    inputMode="decimal"
                    placeholder="₴"
                    value={it.sum}
                    onChange={(e) => patchItem(it.id, { sum: e.target.value })}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Убрать строку"
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
              <span className="muted">{items.length ? "Ещё строка:" : "Расписать сумму:"}</span>
              {ITEM_KINDS.map((k) => (
                <button key={k.value} type="button" className="preset" onClick={() => addItem(k.value)}>
                  <PlusIcon size={14} /> {k.label.toLowerCase()}
                </button>
              ))}
            </div>
          )}
          {leftover > 0 && (
            <p className="field-hint">
              Из {fmtMoney(typed as number)} не расписано {fmtMoney(leftover)}.{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => addItem("extra", String(leftover).replace(".", ","))}
              >
                Добавить строкой «другое»
              </button>
            </p>
          )}
        </div>

        <Field label="Заметки">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.noteLength} />
        </Field>
        <ReminderFields draft={reminder} onChange={setReminder} baseOdo={baseOdo} baseDate={date} />
        <PhotoField existing={existing} pending={files} onPending={setFiles} />
        <FormFooter error={error} onDelete={record ? remove : undefined} />
      </form>
    </Modal>
  );
}
