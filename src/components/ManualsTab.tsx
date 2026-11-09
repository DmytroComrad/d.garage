import { useMemo } from "react";
import { fmtFileSize, hostOf } from "../../shared/format";
import type { Manual } from "../../shared/types";
import { openDialog, useStore, useT } from "../lib/store";
import { FileIcon, LinkIcon, NoteIcon, PencilIcon, ShareIcon } from "./icons";
import { EmptyState } from "./Ledger";

/** Файл мануала віддає сервер власникові: PDF і картинки відкриваються в браузері, решта завантажується. */
export const manualFileUrl = (manual: Pick<Manual, "id">): string => `/api/manuals/${encodeURIComponent(manual.id)}/file`;

function ManualRow({ manual }: { manual: Manual }) {
  const t = useT();
  const href = manual.file ? manualFileUrl(manual) : manual.url;
  const meta = manual.file
    ? manual.file.name === manual.title
      ? fmtFileSize(manual.file.size)
      : `${manual.file.name} · ${fmtFileSize(manual.file.size)}`
    : manual.url
      ? hostOf(manual.url)
      : t.manuals.noteKind;
  const icon = manual.file ? <FileIcon /> : manual.url ? <LinkIcon /> : <NoteIcon />;

  return (
    <article className="manual">
      <span className="rec-icon manual-icon">{icon}</span>
      <div className="manual-body">
        {href ? (
          // Нова вкладка: з телефона мануал відкривається одразу, а журнал лишається на місці.
          <a className="manual-title" href={href} target="_blank" rel="noopener noreferrer nofollow">
            {manual.title}
          </a>
        ) : (
          <span className="manual-title">{manual.title}</span>
        )}
        <span className="rec-meta">{meta}</span>
        {manual.note && <p className="manual-note">{manual.note}</p>}
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label={t.manuals.edit(manual.title)}
        onClick={() => openDialog({ type: "manual", manual })}
      >
        <PencilIcon size={18} />
      </button>
    </article>
  );
}

export function ManualsTab({ carId }: { carId: string }) {
  const t = useT();
  const all = useStore((s) => s.data.manuals);
  const list = useMemo(
    () => all.filter((m) => m.car === carId).sort((a, b) => b.added.localeCompare(a.added) || a.title.localeCompare(b.title)),
    [all, carId],
  );

  return (
    <div className="narrow">
      <div className="section-head">
        <p className="muted">{t.manuals.hint}</p>
        <div className="btn-row">
          {list.length > 0 && (
            <button type="button" className="btn btn-quiet" onClick={() => openDialog({ type: "manualShare", car: carId })}>
              <ShareIcon size={18} /> {t.manuals.share}
            </button>
          )}
          <button type="button" className="btn btn-ink" onClick={() => openDialog({ type: "manual", car: carId })}>
            {t.manuals.add}
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState title={t.manuals.emptyTitle} text={t.manuals.emptyText} />
      ) : (
        <div className="sheet ledger">
          {list.map((m) => (
            <ManualRow key={m.id} manual={m} />
          ))}
        </div>
      )}
    </div>
  );
}
