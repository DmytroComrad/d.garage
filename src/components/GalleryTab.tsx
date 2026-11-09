import { useRef, useState } from "react";
import { canShowPhoto, photoStorage, photoUrl, uploadPhotos } from "../lib/photos";
import { googleHref, openDialog, useCarView, useStore, useT } from "../lib/store";
import { CameraIcon } from "./icons";
import { EmptyState } from "./Ledger";

export function GalleryTab({ carId }: { carId: string }) {
  const t = useT();
  const connected = useStore((s) => s.drive.connected);
  const driveEnabled = useStore((s) => s.config.drive);
  const uploading = useStore((s) => s.uploading);
  const { photos } = useCarView(carId);
  const input = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"gallery" | "record">("gallery");
  // Старі фото переїжджають з Диска самі, але без підключеного Диска їх не дістати: їх лише рахуємо в підказці.
  const visible = photos.filter((p) => canShowPhoto(p, connected));
  const list = visible.filter((p) => p.kind === view).sort((a, b) => b.createdAt - a.createdAt);
  const shots = visible.filter((p) => p.kind === "record").length;
  const stuck = connected ? 0 : photos.filter((p) => photoStorage(p) === "drive").length;

  return (
    <div>
      {stuck > 0 && driveEnabled && (
        <p className="notice">
          <span>{t.gallery.onDrive(stuck)}</span>
          <a className="btn btn-quiet btn-small" href={googleHref("/api/google/drive/connect")}>
            {t.gallery.connect}
          </a>
        </p>
      )}
      <div className="section-head">
        <div className="segmented" role="group" aria-label={t.gallery.viewAria}>
          <button
            type="button"
            className={view === "gallery" ? "is-on" : ""}
            aria-pressed={view === "gallery"}
            onClick={() => setView("gallery")}
          >
            {t.gallery.gallery}
          </button>
          <button
            type="button"
            className={view === "record" ? "is-on" : ""}
            aria-pressed={view === "record"}
            onClick={() => setView("record")}
          >
            {t.gallery.fromRecords(shots)}
          </button>
        </div>
        {view === "gallery" && (
          <>
            <button type="button" className="btn btn-ink" disabled={uploading > 0} onClick={() => input.current?.click()}>
              <CameraIcon size={18} /> {uploading > 0 ? t.gallery.uploading(uploading) : t.gallery.add}
            </button>
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                void uploadPhotos(files, { car: carId, kind: "gallery", recordId: null });
              }}
            />
          </>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={view === "gallery" ? t.gallery.emptyGalleryTitle : t.gallery.emptyRecordsTitle}
          text={view === "gallery" ? t.gallery.emptyGalleryText : t.gallery.emptyRecordsText}
        />
      ) : (
        <div className="photo-wall">
          {list.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="photo-tile"
              aria-label={t.gallery.openPhoto(p.name)}
              onClick={() => openDialog({ type: "lightbox", photos: list, index: i })}
            >
              <img
                src={photoUrl(p, "thumb")}
                alt=""
                loading="lazy"
                width={p.width ?? undefined}
                height={p.height ?? undefined}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
