import { sumMoney } from "../../shared/calc";
import { fmtDate, fmtMoney0 } from "../../shared/format";
import type { ServiceRecord, Wish } from "../../shared/types";
import { openDialog, setWishDone, useCarView, useT } from "../lib/store";
import { CheckIcon, LinkIcon } from "./icons";
import { EmptyState } from "./Ledger";

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
        {wish.price != null && <span className="wish-price num">≈ {fmtMoney0(wish.price)}</span>}
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
  const open = wishes.filter((w) => !w.done);
  const done = wishes.length - open.length;
  const planned = sumMoney(open.map((w) => w.price ?? 0));

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
          <p className="wish-totals">
            <span>{t.wishes.planned(open.length)}</span>
            {planned > 0 && <span className="num">≈ {fmtMoney0(planned)}</span>}
            {done > 0 && <span>{t.wishes.doneCount(done)}</span>}
          </p>
          <div className="sheet ledger">
            {wishes.map((w) => (
              <WishRow key={w.id} wish={w} record={wishRecords.get(w.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
