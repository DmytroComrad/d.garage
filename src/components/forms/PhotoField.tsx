import { useMemo, useRef } from "react";
import type { Photo } from "../../../shared/types";
import { photoUrl } from "../../lib/photos";
import { closeDialog, setTab, useStore, useT } from "../../lib/store";
import { CameraIcon, CloseIcon } from "../icons";

/** Фото в записі: уже завантажені плюс вибрані, які підуть на Диск після збереження. */
export function PhotoField({
  existing,
  pending,
  onPending,
}: {
  existing: Photo[];
  pending: File[];
  onPending: (files: File[]) => void;
}) {
  const t = useT();
  const driveEnabled = useStore((s) => s.config.drive);
  const connected = useStore((s) => s.drive.connected);
  const input = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => pending.map((f) => URL.createObjectURL(f)), [pending]);

  if (!driveEnabled) return null;

  return (
    <div className="field">
      <span className="field-label">{t.photos.label}</span>
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
                aria-label={t.photos.remove(file.name)}
                onClick={() => onPending(pending.filter((_, j) => j !== i))}
              >
                <CloseIcon size={14} />
              </button>
            </span>
          ))}
          <button type="button" className="photo-add" onClick={() => input.current?.click()} aria-label={t.photos.add}>
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
          {t.photos.hint}{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              closeDialog();
              setTab("data");
            }}
          >
            {t.photos.connect}
          </button>
        </span>
      )}
    </div>
  );
}
