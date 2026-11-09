import { useState, type FormEvent } from "react";
import { LIMITS } from "../../../shared/constants";
import { CURRENCY_SYMBOLS, type Currency } from "../../../shared/currency";
import { genId, numInput, todayISO } from "../../../shared/format";
import { normalizeUrl, parsePriceRange } from "../../../shared/parse";
import type { Wish } from "../../../shared/types";
import { closeDialog, dispatch, toast, useStore, useT } from "../../lib/store";
import { CloseIcon, PlusIcon } from "../icons";
import { Modal } from "../Modal";
import { CarSelect, Field, FormFooter, MoneyInput, useMainCurrency } from "./common";

/** Хотілка: що зробити, приблизна ціна, посилання на товари. */
export function WishForm({ wish }: { wish?: Wish }) {
  const t = useT();
  const active = useStore((s) => s.active);
  const cars = useStore((s) => s.data.cars);
  const [car, setCar] = useState(wish?.car ?? active ?? cars[0]?.id ?? "");
  const [title, setTitle] = useState(wish?.title ?? "");
  const [price, setPrice] = useState(
    wish?.price == null ? "" : wish.priceMax != null ? `${numInput(wish.price)}-${numInput(wish.priceMax)}` : numInput(wish.price),
  );
  const main = useMainCurrency();
  const [currency, setCurrency] = useState<Currency>(wish?.currency ?? main);
  const [links, setLinks] = useState<string[]>(wish?.links.length ? wish.links : [""]);
  const [note, setNote] = useState(wish?.note ?? "");
  const [error, setError] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError(t.wishForm.errTitle);
    const parsedPrice = parsePriceRange(price);
    if (parsedPrice === "invalid" || (parsedPrice.priceMax ?? parsedPrice.price ?? 0) > LIMITS.maxSum) {
      return setError(t.wishForm.errPrice);
    }
    const urls: string[] = [];
    for (const [i, raw] of links.entries()) {
      if (!raw.trim()) continue;
      const url = normalizeUrl(raw);
      if (!url) return setError(t.wishForm.errLink(i + 1));
      if (!urls.includes(url)) urls.push(url);
    }

    dispatch({
      type: "wish.put",
      data: {
        id: wish?.id ?? genId(),
        car,
        title: title.trim(),
        price: parsedPrice.price,
        priceMax: parsedPrice.priceMax,
        currency,
        links: urls,
        note: note.trim(),
        added: wish?.added ?? todayISO(),
        done: wish?.done ?? false,
        doneDate: wish?.doneDate ?? null,
        recordId: wish?.recordId ?? null,
      },
    });
    closeDialog();
    toast(t.common.saved);
  };

  const remove = () => {
    if (!wish) return;
    dispatch({ type: "wish.del", id: wish.id });
    closeDialog();
    toast(t.wishForm.deleted);
  };

  return (
    <Modal title={wish ? t.wishForm.titleEdit : t.wishForm.titleNew} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <CarSelect value={car} onChange={setCar} />
        <Field label={t.wishForm.what}>
          <textarea
            rows={2}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.wishForm.placeholder}
            maxLength={LIMITS.titleLength}
          />
        </Field>
        <Field label={t.wishForm.price(CURRENCY_SYMBOLS[currency])} hint={t.wishForm.priceHint}>
          <MoneyInput currency={currency} onCurrency={setCurrency}>
            <input value={price} onChange={(e) => setPrice(e.target.value)} />
          </MoneyInput>
        </Field>
        <div className="field">
          <span className="field-label">{t.wishForm.links}</span>
          <ul className="link-list">
            {links.map((value, i) => (
              <li key={i} className="link-row">
                <input
                  type="url"
                  inputMode="url"
                  aria-label={`${t.wishForm.links} ${i + 1}`}
                  value={value}
                  placeholder="https://…"
                  maxLength={LIMITS.urlLength}
                  onChange={(e) => setLinks((list) => list.map((v, j) => (j === i ? e.target.value : v)))}
                />
                {(links.length > 1 || value) && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t.wishForm.removeLink}
                    onClick={() => setLinks((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [""]))}
                  >
                    <CloseIcon size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {links.length < LIMITS.linksPerWish && (
            <div className="item-add">
              <button type="button" className="preset" onClick={() => setLinks((list) => [...list, ""])}>
                <PlusIcon size={14} /> {t.wishForm.addLink}
              </button>
            </div>
          )}
        </div>
        <Field label={t.wishForm.note}>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.noteLength} />
        </Field>
        <FormFooter error={error} onDelete={wish ? remove : undefined} deleteQuestion={t.wishForm.deleteQ} />
      </form>
    </Modal>
  );
}
