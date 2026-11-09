import { wishesTotal } from "../../shared/calc";
import { fmtDate, fmtMoneyRange } from "../../shared/format";
import { LOCALES } from "../../shared/i18n";
import { sortWishes } from "../../shared/listview";
import type { ServiceRecord, Wish } from "../../shared/types";
import { openDialog, setWishDone, useCarView, useStore, useT } from "../lib/store";
import { CheckIcon, LinkIcon } from "./icons";
import { EmptyState } from "./Ledger";
import { WishSortSelect, useWishSort } from "./ListTools";

/** Коротка назва сайту для посилання: «rozetka.com.ua» замість довгої адреси. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

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
        {wish.price != null && <span className="wish-price num">≈ {fmtMoneyRange(wish.price, wish.priceMax)}</span>}
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
  const { wishes, wishRecords } = useCarView(carId);
  const lang = useStore((s) => s.prefs.lang);
  const [sort, setSort] = useWishSort();
  const shown = sortWishes(wishes, sort, new Intl.Collator(LOCALES[lang]));
  const open = wishes.filter((w) => !w.done);
  const done = wishes.length - open.length;
  const planned = wishesTotal(open);

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
              {planned.max > 0 && <span className="num">≈ {fmtMoneyRange(planned.min, planned.max)}</span>}
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
