import { wishesTotal } from "../../shared/calc";
import { CURRENCIES } from "../../shared/currency";
import { fmtDate, fmtMoneyRange, hostOf } from "../../shared/format";
import { LOCALES } from "../../shared/i18n";
import { sortWishes } from "../../shared/listview";
import type { ServiceRecord, Wish } from "../../shared/types";
import { openDialog, setWishDone, useCarView, useStore, useT } from "../lib/store";
import { CheckIcon, LinkIcon } from "./icons";
import { EmptyState } from "./Ledger";
import { WishSortSelect, useWishSort } from "./ListTools";

function WishRow({ wish, record }: { wish: Wish; record: ServiceRecord | undefined }) {
  const t = useT();
  const meta = [wish.note, wish.done && wish.doneDate ? `✓ ${fmtDate(wish.doneDate)}` : ""].filter(Boolean).join(" · ");
  return (
    <article className={`wish${wish.done ? " is-done" : ""}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={wish.done}
        aria-label={t.wishes.markDone(wish.title)}
        className={`wish-check${wish.done ? " is-on" : ""}`}
        onClick={() => setWishDone(wish, !wish.done)}
      >
        {wish.done && <CheckIcon size={18} />}
      </button>
      <div className="wish-body">
        <button type="button" className="wish-main" onClick={() => openDialog({ type: "wish", wish })}>
          <span className="wish-title">{wish.title}</span>
          {meta && <span className="rec-meta">{meta}</span>}
        </button>
        {wish.links.length > 0 && (
          <ul className="wish-links">
            {wish.links.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer nofollow">
                  <LinkIcon size={14} />
                  <span>{hostOf(url)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="wish-side">
        {wish.price != null && (
          <span className="wish-price num">≈ {fmtMoneyRange(wish.price, wish.priceMax, wish.currency)}</span>
        )}
        {record && (
          <button
            type="button"
            className={`tag tag-link${wish.done ? "" : " tag-bad"}`}
            title={t.wishes.openRecord}
            onClick={() => openDialog({ type: "service", record })}
          >
            {wish.done ? t.wishes.inExpenses : t.stale.tag}
          </button>
        )}
      </div>
    </article>
  );
}

export function WishesTab({ carId }: { carId: string }) {
  const t = useT();
  const { wishes, wishRecords, money } = useCarView(carId);
  const lang = useStore((s) => s.prefs.lang);
  const [sort, setSort] = useWishSort();
  // За ціною хотілки в різних валютах порівнюються в основній.
  const top = (w: Wish): number | null => {
    const inMain = money.wish(w);
    return inMain ? (inMain.priceMax ?? inMain.price) : null;
  };
  const shown = sortWishes(wishes, sort, new Intl.Collator(LOCALES[lang]), top);
  const open = wishes.filter((w) => !w.done);
  const done = wishes.length - open.length;
  // У планах — в основній валюті за курсом на день, коли хотілку додали. Без курсу — окремо, як є.
  const converted = open.map((w) => money.wish(w));
  const planned = wishesTotal(converted.filter((w): w is Wish => w !== null));
  const plannedText = [
    planned.max > 0 ? fmtMoneyRange(planned.min, planned.max) : "",
    ...CURRENCIES.map((c) => {
      const range = wishesTotal(open.filter((w, i) => converted[i] === null && w.currency === c));
      return range.max > 0 ? fmtMoneyRange(range.min, range.max, c) : "";
    }),
  ]
    .filter(Boolean)
    .join(" + ");

  return (
    <div className="narrow">
      <div className="section-head">
        <p className="muted">{t.wishes.hint}</p>
        <button type="button" className="btn btn-ink" onClick={() => openDialog({ type: "wish" })}>
          {t.wishes.add}
        </button>
      </div>

      {wishes.length === 0 ? (
        <EmptyState title={t.wishes.emptyTitle} text={t.wishes.emptyText} />
      ) : (
        <>
          <div className="wish-head">
            <p className="wish-totals">
              <span>{t.wishes.planned(open.length)}</span>
              {plannedText && <span className="num">≈ {plannedText}</span>}
              {done > 0 && <span>{t.wishes.doneCount(done)}</span>}
            </p>
            {wishes.length > 1 && <WishSortSelect value={sort} onChange={setSort} />}
          </div>
          <div className="sheet ledger">
            {shown.map((w) => (
              <WishRow key={w.id} wish={w} record={wishRecords.get(w.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
