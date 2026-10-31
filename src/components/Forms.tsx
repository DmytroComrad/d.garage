import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { sumMoney } from "../../shared/calc";
import { CATEGORIES, ITEM_KINDS } from "../../shared/constants";
import { fmtKm, fmtMoney, fmtNum, genId, nameKey, todayISO } from "../../shared/format";
import { parseDecimal, parseMoney, parseOdo } from "../../shared/parse";
import { addMonths, reminderStatus } from "../../shared/reminders";
import type { FuelRecord, ItemKind, Op, Photo, Reminder, ServiceRecord } from "../../shared/types";
import { photoUrl, uploadPhotos } from "../lib/photos";
import { carRecords, closeDialog, currentOdo, dispatch, dueReminderDialog, openDialog, setActive, setTab, toast, useApp } from "../lib/store";
import { CameraIcon, CloseIcon, PlusIcon } from "./icons";
import { Modal } from "./Modal";

const Field = ({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) => (
  <label className="field">
    <span className="field-label">{label}</span>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </label>
);

const CarSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const { data } = useApp();
  if (data.cars.length < 2) return null;
  return (
    <Field label="Машина">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {data.cars.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </Field>
  );
};

const Suggest = ({ id, values }: { id: string; values: string[] }) => (
  <datalist id={id}>
    {[...new Set(values.filter(Boolean))].sort().map((v) => (
      <option key={v} value={v} />
    ))}
  </datalist>
);

/** Максимальний пробіг машини серед усіх записів, крім того, що редагується. */
const usePrevOdo = (carId: string, excludeId?: string): number | null => {
  const { data } = useApp();
  return useMemo(() => {
    const { service, fuel } = carRecords(data, carId);
    const odos = [...service, ...fuel].filter((r) => r.id !== excludeId && r.odo != null).map((r) => r.odo as number);
    return odos.length ? Math.max(...odos) : null;
  }, [data, carId, excludeId]);
};

const DeleteRow = ({ onDelete, onCancelHint }: { onDelete: () => void; onCancelHint?: string }) => {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="btn btn-danger-quiet" onClick={() => setAsking(true)}>
        Удалить
      </button>
    );
  }
  return (
    <span className="confirm-inline">
      <span>{onCancelHint ?? "Удалить запись?"}</span>
      <button type="button" className="btn btn-danger" onClick={onDelete}>
        Да, удалить
      </button>
    </span>
  );
};

/* Напоминание в записи */

type ReminderDraft = { on: boolean; title: string; km: string; date: string };

const reminderDraft = (linked: Reminder | undefined, base: number | null): ReminderDraft => ({
  on: Boolean(linked),
  title: linked?.title ?? "",
  km: linked?.dueOdo != null && base != null ? String(Math.max(0, linked.dueOdo - base)) : "",
  date: linked?.dueDate ?? "",
});

const KM_PRESETS = [5000, 10000, 15000];
const MONTH_PRESETS: [number, string][] = [
  [6, "через полгода"],
  [12, "через год"],
];

function ReminderFields({
  draft,
  onChange,
  baseOdo,
  baseDate,
  titles,
}: {
  draft: ReminderDraft;
  onChange: (d: ReminderDraft) => void;
  baseOdo: number | null;
  baseDate: string;
  titles: string[];
}) {
  const listId = useId();
  const km = parseOdo(draft.km);
  const target = km && !Number.isNaN(km) && baseOdo != null ? baseOdo + km : null;

  return (
    <div className={`reminder-box${draft.on ? " is-on" : ""}`}>
      <label className="check">
        <input type="checkbox" checked={draft.on} onChange={(e) => onChange({ ...draft, on: e.target.checked })} />
        <span>Напомнить через…</span>
      </label>
      {draft.on && (
        <div className="reminder-fields">
          <Field label="Что нужно сделать или заменить">
            <input
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              placeholder="Например: замена масла"
              list={listId}
              maxLength={200}
            />
          </Field>
          <Suggest id={listId} values={titles} />
          <div className="field-row">
            <Field label="Через, км" hint={target != null ? `На пробеге ${fmtKm(target)}` : undefined}>
              <input
                inputMode="numeric"
                value={draft.km}
                onChange={(e) => onChange({ ...draft, km: e.target.value })}
                placeholder="10 000"
              />
            </Field>
            <Field label="Или к дате">
              <input type="date" value={draft.date} onChange={(e) => onChange({ ...draft, date: e.target.value })} />
            </Field>
          </div>
          <div className="preset-row">
            {KM_PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                className={`preset${parseOdo(draft.km) === v ? " is-on" : ""}`}
                onClick={() => onChange({ ...draft, km: String(v) })}
              >
                {fmtNum(v)} км
              </button>
            ))}
            {MONTH_PRESETS.map(([months, label]) => {
              const value = addMonths(baseDate || todayISO(), months);
              return (
                <button
                  key={months}
                  type="button"
                  className={`preset${draft.date === value ? " is-on" : ""}`}
                  onClick={() => onChange({ ...draft, date: value })}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="field-hint">Покажем уведомление за 1000 и за 500 км, а по дате — за месяц и за неделю.</p>
        </div>
      )}
    </div>
  );
}

type BuiltReminder = { error: string } | { reminder: Reminder | null };

function buildReminder(
  draft: ReminderDraft,
  opts: { car: string; recordId: string; baseOdo: number | null; fallbackTitle: string; linked?: Reminder },
): BuiltReminder {
  if (!draft.on) return { reminder: null };
  const km = parseOdo(draft.km);
  if (km !== null && Number.isNaN(km)) return { error: "В напоминании километры — только цифры." };
  const date = draft.date || null;
  if (!km && !date) return { error: "Укажи, через сколько километров или к какой дате напомнить." };
  if (km && opts.baseOdo == null) return { error: "Чтобы считать километры, укажи пробег этой записи." };
  const dueOdo = km && opts.baseOdo != null ? opts.baseOdo + km : null;
  const due = { dueOdo, dueDate: date };
  const unchanged = opts.linked && opts.linked.dueOdo === dueOdo && opts.linked.dueDate === date;
  return {
    reminder: {
      id: opts.linked?.id ?? genId(),
      car: opts.car,
      title: draft.title.trim() || opts.fallbackTitle,
      dueOdo,
      dueDate: date,
      done: false,
      doneDate: null,
      // Новий поріг рахуємо від поточного стану: щойно створене нагадування не вискакує відразу ж.
      notified: unchanged && opts.linked ? opts.linked.notified : reminderStatus(due, opts.baseOdo, todayISO()).level,
      recordId: opts.recordId,
    },
  };
}

const reminderOps = (built: Reminder | null, linked?: Reminder): Op[] => {
  if (built) return [{ type: "reminder.put", data: built }];
  return linked ? [{ type: "reminder.del", id: linked.id }] : [];
};

/* Фото в записи */

function PhotoField({
  existing,
  pending,
  onPending,
  connected,
}: {
  existing: Photo[];
  pending: File[];
  onPending: (files: File[]) => void;
  connected: boolean;
}) {
  const { config } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => pending.map((f) => URL.createObjectURL(f)), [pending]);

  if (!config.drive) return null;

  return (
    <div className="field">
      <span className="field-label">Фото и скриншоты</span>
      {connected ? (
        <div className="photo-row">
          {existing.map((p) => (
            <img key={p.id} className="photo-chip" src={photoUrl(p, "thumb")} alt={p.name} loading="lazy" />
          ))}
          {pending.map((file, i) => (
            <span key={previews[i]} className="photo-chip-wrap">
              <img className="photo-chip" src={previews[i]} alt={file.name} />
              <button
                type="button"
                className="photo-remove"
                aria-label={`Убрать ${file.name}`}
                onClick={() => onPending(pending.filter((_, j) => j !== i))}
              >
                <CloseIcon size={14} />
              </button>
            </span>
          ))}
          <button type="button" className="photo-add" onClick={() => input.current?.click()} aria-label="Добавить фото">
            <CameraIcon />
          </button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              onPending([...pending, ...Array.from(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        <span className="field-hint">
          Фото хранятся на твоём Google Диске.{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              closeDialog();
              setTab("data");
            }}
          >
            Подключить Диск
          </button>
        </span>
      )}
    </div>
  );
}

/* После сохранения */

const finishSave = (car: string, isNew: boolean, files: File[], recordId: string): void => {
  setActive(car);
  const next = dueReminderDialog(car, isNew);
  closeDialog(next);
  // Вікно нагадування саме показує, що запис прийнято: тост лише перекрив би його.
  if (!next) toast("Сохранено");
  void uploadPhotos(files, { car, kind: "record", recordId });
};

const FormFooter = ({ error, editing, onDelete, busy }: { error: string; editing: boolean; onDelete: () => void; busy?: boolean }) => (
  <>
    {error && (
      <p className="form-error" role="alert">
        {error}
      </p>
    )}
    <div className="form-actions">
      {editing && <DeleteRow onDelete={onDelete} />}
      <span className="spacer" />
      <button type="button" className="btn btn-quiet" onClick={() => closeDialog()}>
        Отмена
      </button>
      <button type="submit" className="btn btn-ink" disabled={busy}>
        Сохранить
      </button>
    </div>
  </>
);

/* Заправка */

export function FuelForm({ record, car: carProp }: { record?: FuelRecord; car?: string }) {
  const { data, active, drive } = useApp();
  const [car, setCar] = useState(record?.car ?? carProp ?? active ?? data.cars[0]?.id ?? "");
  const [date, setDate] = useState(record?.date ?? todayISO());
  const [odo, setOdo] = useState(record ? String(record.odo) : "");
  const [liters, setLiters] = useState(record ? String(record.liters).replace(".", ",") : "");
  const [sum, setSum] = useState(record ? String(record.sum).replace(".", ",") : "");
  const [station, setStation] = useState(record?.station ?? "");
  const [full, setFull] = useState(record?.full ?? true);
  const [note, setNote] = useState(record?.note ?? "");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const prev = usePrevOdo(car, record?.id);
  const parsedOdo = parseOdo(odo);
  const baseOdo = parsedOdo != null && !Number.isNaN(parsedOdo) ? parsedOdo : null;
  const linked = record ? data.reminders.find((r) => r.recordId === record.id && !r.done) : undefined;
  const [reminder, setReminder] = useState(() => reminderDraft(linked, record?.odo ?? null));

  const stationsId = useId();
  const parsedLiters = parseDecimal(liters);
  const parsedSum = parseMoney(sum);
  const price = parsedLiters && parsedSum ? parsedSum / parsedLiters : null;
  const existing = record ? data.photos.filter((p) => p.recordId === record.id) : [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!date) return setError("Укажи дату.");
    if (parsedOdo !== null && Number.isNaN(parsedOdo)) return setError("Пробег — только цифры.");
    if (parsedOdo === null) return setError("Для заправки нужен пробег — без него не посчитать расход.");
    if (!parsedLiters || Number.isNaN(parsedLiters)) return setError("Укажи литры.");
    if (!parsedSum || Number.isNaN(parsedSum)) return setError("Укажи сумму с чека.");

    const id = record?.id ?? genId();
    const built = buildReminder(reminder, {
      car,
      recordId: id,
      baseOdo: parsedOdo,
      fallbackTitle: "Обслуживание",
      linked,
    });
    if ("error" in built) return setError(built.error);

    const next: FuelRecord = {
      id,
      car,
      date,
      odo: parsedOdo,
      liters: parsedLiters,
      sum: parsedSum,
      station: station.trim(),
      full,
      note: note.trim(),
    };
    dispatch({ type: "fuel.put", data: next }, ...reminderOps(built.reminder, linked));
    finishSave(car, !record, files, id);
  };

  const remove = () => {
    if (!record) return;
    dispatch({ type: "fuel.del", id: record.id }, ...(linked ? [{ type: "reminder.del", id: linked.id } as Op] : []));
    closeDialog();
    toast("Запись удалена");
  };

  const hint = prev != null ? `Прошлый: ${fmtKm(prev)}` : undefined;

  return (
    <Modal title={record ? "Заправка" : "Новая заправка"} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <CarSelect value={car} onChange={setCar} />
        <div className="field-row">
          <Field label="Дата">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Пробег, км" hint={hint}>
            <input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} placeholder={prev != null ? fmtNum(prev) : ""} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Литры">
            <input inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} />
          </Field>
          <Field label="Сумма ₴" hint={price && Number.isFinite(price) ? `≈ ${fmtMoney(price)}/л` : undefined}>
            <input inputMode="decimal" value={sum} onChange={(e) => setSum(e.target.value)} />
          </Field>
        </div>
        <Field label="АЗС">
          <input value={station} onChange={(e) => setStation(e.target.value)} list={stationsId} maxLength={200} />
        </Field>
        <Suggest id={stationsId} values={data.fuel.map((f) => f.station)} />
        <label className="check">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
          <span>
            Полный бак <span className="muted">— нужно для точного расхода</span>
          </span>
        </label>
        <Field label="Заметка">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </Field>
        <ReminderFields
          draft={reminder}
          onChange={setReminder}
          baseOdo={baseOdo}
          baseDate={date}
          titles={data.reminders.map((r) => r.title)}
        />
        <PhotoField existing={existing} pending={files} onPending={setFiles} connected={drive.connected} />
        <FormFooter error={error} editing={Boolean(record)} onDelete={remove} />
      </form>
    </Modal>
  );
}

/* Сервис */

type ItemDraft = { id: string; kind: ItemKind; name: string; sum: string };

const parseItemSum = (raw: string): number | null => {
  const value = parseMoney(raw);
  return value == null || Number.isNaN(value) ? null : value;
};

export function ServiceForm({ record, car: carProp }: { record?: ServiceRecord; car?: string }) {
  const { data, active, drive } = useApp();
  const [car, setCar] = useState(record?.car ?? carProp ?? active ?? data.cars[0]?.id ?? "");
  const [date, setDate] = useState(record?.date ?? todayISO());
  const [odo, setOdo] = useState(record?.odo != null ? String(record.odo) : "");
  const [cat, setCat] = useState(record?.cat ?? CATEGORIES[0]);
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
  const hasOdo = parsedOdo != null && !Number.isNaN(parsedOdo);
  const baseOdo = hasOdo ? parsedOdo : (prev ?? currentOdo(car));
  const linked = record ? data.reminders.find((r) => r.recordId === record.id && !r.done) : undefined;
  const [reminder, setReminder] = useState(() =>
    reminderDraft(linked, record?.odo ?? currentOdo(record?.car ?? "")),
  );

  const whereId = useId();
  const namesId = useId();
  const itemsTotal = sumMoney(items.map((it) => parseItemSum(it.sum) ?? 0));
  const typed = parseMoney(sum);
  const leftover = items.length && typed != null && !Number.isNaN(typed) ? sumMoney([typed, -itemsTotal]) : 0;
  const existing = record ? data.photos.filter((p) => p.recordId === record.id) : [];

  const addItem = (kind: ItemKind, preset = "") =>
    setItems((list) => [...list, { id: genId(), kind, name: "", sum: preset }]);
  const patchItem = (id: string, patch: Partial<ItemDraft>) =>
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!date) return setError("Укажи дату.");
    if (parsedOdo !== null && Number.isNaN(parsedOdo)) return setError("Пробег — только цифры.");
    if (!what.trim()) return setError("Напиши, что сделано или куплено.");

    let total: number;
    if (items.length) {
      if (items.some((it) => parseItemSum(it.sum) == null)) return setError("Укажи сумму в каждой строке расходов.");
      total = itemsTotal;
    } else {
      if (typed === null || Number.isNaN(typed)) return setError("Укажи сумму (0, если бесплатно).");
      total = typed;
    }

    const id = record?.id ?? genId();
    const built = buildReminder(reminder, {
      car,
      recordId: id,
      baseOdo,
      fallbackTitle: what.trim().slice(0, 200),
      linked,
    });
    if ("error" in built) return setError(built.error);

    const next: ServiceRecord = {
      id,
      car,
      date,
      odo: hasOdo ? parsedOdo : null,
      cat,
      what: what.trim(),
      where: where.trim(),
      sum: total,
      note: note.trim(),
      items: items.map((it) => ({ id: it.id, kind: it.kind, name: it.name.trim(), sum: parseItemSum(it.sum) ?? 0 })),
    };
    dispatch({ type: "service.put", data: next }, ...reminderOps(built.reminder, linked));
    finishSave(car, !record, files, id);
  };

  const remove = () => {
    if (!record) return;
    dispatch({ type: "service.del", id: record.id }, ...(linked ? [{ type: "reminder.del", id: linked.id } as Op] : []));
    closeDialog();
    toast("Запись удалена");
  };

  const categories = CATEGORIES.includes(cat as (typeof CATEGORIES)[number]) ? [...CATEGORIES] : [...CATEGORIES, cat];

  return (
    <Modal title={record ? "Запись" : "Ремонт, покупка, сервис"} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <CarSelect value={car} onChange={setCar} />
        <div className="field-row">
          <Field label="Дата">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Пробег, км" hint={prev != null ? `Прошлый: ${fmtKm(prev)}` : "Можно не указывать"}>
            <input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} placeholder={prev != null ? fmtNum(prev) : ""} />
          </Field>
        </div>
        <div className="field">
          <span className="field-label" id={`${whereId}-cat`}>Категория</span>
          <div className="chip-grid" role="group" aria-labelledby={`${whereId}-cat`}>
            {categories.map((c) => (
              <button key={c} type="button" className={`pick${c === cat ? " is-on" : ""}`} aria-pressed={c === cat} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <Field label="Что сделано / куплено">
          <textarea rows={2} value={what} onChange={(e) => setWhat(e.target.value)} maxLength={2000} />
        </Field>
        <Field label="Где">
          <input value={where} onChange={(e) => setWhere(e.target.value)} list={whereId} maxLength={200} />
        </Field>
        <Suggest id={whereId} values={data.service.map((r) => r.where)} />

        <div className="field">
          <label className="field-label" htmlFor={`${whereId}-sum`}>Сумма ₴</label>
          {items.length ? (
            <output id={`${whereId}-sum`} className="sum-total">
              {fmtMoney(itemsTotal)}
            </output>
          ) : (
            <input id={`${whereId}-sum`} inputMode="decimal" value={sum} onChange={(e) => setSum(e.target.value)} />
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
                    maxLength={200}
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
          <Suggest id={namesId} values={data.service.flatMap((r) => r.items.map((i) => i.name))} />
          <div className="item-add">
            <span className="muted">{items.length ? "Ещё строка:" : "Расписать сумму:"}</span>
            {ITEM_KINDS.map((k) => (
              <button key={k.value} type="button" className="preset" onClick={() => addItem(k.value)}>
                <PlusIcon size={14} /> {k.label.toLowerCase()}
              </button>
            ))}
          </div>
          {leftover > 0 && (
            <p className="field-hint">
              Из {fmtMoney(typed)} не расписано {fmtMoney(leftover)}.{" "}
              <button type="button" className="link-btn" onClick={() => addItem("extra", String(leftover).replace(".", ","))}>
                Добавить строкой «другое»
              </button>
            </p>
          )}
        </div>

        <Field label="Заметки">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </Field>
        <ReminderFields
          draft={reminder}
          onChange={setReminder}
          baseOdo={baseOdo}
          baseDate={date}
          titles={data.reminders.map((r) => r.title)}
        />
        <PhotoField existing={existing} pending={files} onPending={setFiles} connected={drive.connected} />
        <FormFooter error={error} editing={Boolean(record)} onDelete={remove} />
      </form>
    </Modal>
  );
}

/* Новая машина */

export function CarForm() {
  const { data } = useApp();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return setError("Напиши название.");
    if (data.cars.some((c) => nameKey(c.name) === nameKey(value))) return setError("Такая машина уже есть.");
    const id = genId();
    dispatch({ type: "car.put", data: { id, name: value } });
    setActive(id);
    setTab("service");
    closeDialog();
    toast("Сохранено");
  };

  return (
    <Modal title="Новая машина" onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <Field label="Как называешь машину">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Крыся, Пассат, Рабочая" maxLength={80} />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <span className="spacer" />
          <button type="button" className="btn btn-quiet" onClick={() => closeDialog()}>
            Отмена
          </button>
          <button type="submit" className="btn btn-ink">
            Добавить машину
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* Отдельное напоминание */

export function ReminderForm({ reminder }: { reminder?: Reminder }) {
  const { data, active } = useApp();
  const [car, setCar] = useState(reminder?.car ?? active ?? data.cars[0]?.id ?? "");
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [odo, setOdo] = useState(reminder?.dueOdo != null ? String(reminder.dueOdo) : "");
  const [date, setDate] = useState(reminder?.dueDate ?? "");
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const now = currentOdo(car);
  const listId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError("Напиши, что нужно сделать.");
    const dueOdo = parseOdo(odo);
    if (dueOdo !== null && Number.isNaN(dueOdo)) return setError("Пробег — только цифры.");
    if (dueOdo === null && !date) return setError("Укажи пробег или дату.");
    const due = { dueOdo, dueDate: date || null };
    const unchanged = reminder && reminder.dueOdo === dueOdo && reminder.dueDate === due.dueDate;
    dispatch({
      type: "reminder.put",
      data: {
        id: reminder?.id ?? genId(),
        car,
        title: title.trim(),
        ...due,
        done: reminder?.done ?? false,
        doneDate: reminder?.doneDate ?? null,
        notified: unchanged && reminder ? reminder.notified : reminderStatus(due, now, todayISO()).level,
        recordId: reminder?.recordId ?? null,
      },
    });
    closeDialog();
    toast("Сохранено");
  };

  const remove = () => {
    if (!reminder) return;
    dispatch({ type: "reminder.del", id: reminder.id });
    closeDialog();
    toast("Напоминание удалено");
  };

  return (
    <Modal title={reminder ? "Напоминание" : "Новое напоминание"} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <CarSelect value={car} onChange={setCar} />
        <Field label="Что нужно сделать или заменить">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: замена масла" list={listId} maxLength={200} />
        </Field>
        <Suggest id={listId} values={data.reminders.map((r) => r.title)} />
        <div className="field-row">
          <Field label="На пробеге, км" hint={now != null ? `Сейчас: ${fmtKm(now)}` : undefined}>
            <input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} />
          </Field>
          <Field label="Или к дате">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {now != null && (
          <div className="preset-row">
            {KM_PRESETS.map((v) => (
              <button key={v} type="button" className="preset" onClick={() => setOdo(String(now + v))}>
                через {fmtNum(v)} км
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          {reminder &&
            (asking ? (
              <span className="confirm-inline">
                <span>Удалить?</span>
                <button type="button" className="btn btn-danger" onClick={remove}>
                  Да, удалить
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-danger-quiet" onClick={() => setAsking(true)}>
                Удалить
              </button>
            ))}
          <span className="spacer" />
          <button type="button" className="btn btn-quiet" onClick={() => closeDialog()}>
            Отмена
          </button>
          <button type="submit" className="btn btn-ink">
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

export const openCarForm = (): void => openDialog({ type: "car" });
