import { useRef, useState } from "react";
import { photoUrl, uploadPhotos } from "../lib/photos";
import { openDialog, setTab, useCarView, useStore } from "../lib/store";
import { CameraIcon } from "./icons";
import { EmptyState } from "./Ledger";

export function GalleryTab({ carId }: { carId: string }) {
  const connected = useStore((s) => s.drive.connected);
  const driveEnabled = useStore((s) => s.config.drive);
  const uploading = useStore((s) => s.uploading);
  const { photos } = useCarView(carId);
  const input = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"gallery" | "record">("gallery");
  const list = photos.filter((p) => p.kind === view).sort((a, b) => b.createdAt - a.createdAt);
  const shots = photos.filter((p) => p.kind === "record").length;

  if (!driveEnabled) {
    return (
      <EmptyState
        narrow
        title="Галерея пока недоступна"
        text="Фото будут храниться на твоём Google Диске. Подключение появится здесь, как только его настроят на сайте."
      />
    );
  }

  if (!connected) {
    return (
      <EmptyState
        narrow
        title="Подключи Google Диск"
        text="Фото машины и скриншоты чеков будут лежать в отдельной папке на твоём Диске. Сайт получает доступ только к тем файлам, которые загрузил сам: остальное на Диске он не видит."
      >
        <a className="btn btn-ink" href="/api/google/drive/connect">
          Подключить Google Диск
        </a>
        <button type="button" className="link-btn" onClick={() => setTab("data")}>
          Подробнее на вкладке «Данные»
        </button>
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="section-head">
        <div className="segmented" role="group" aria-label="Что показать">
          <button
            type="button"
            className={view === "gallery" ? "is-on" : ""}
            aria-pressed={view === "gallery"}
            onClick={() => setView("gallery")}
          >
            Галерея
          </button>
          <button
            type="button"
            className={view === "record" ? "is-on" : ""}
            aria-pressed={view === "record"}
            onClick={() => setView("record")}
          >
            Из записей{shots ? ` (${shots})` : ""}
          </button>
        </div>
        {view === "gallery" && (
          <>
            <button type="button" className="btn btn-ink" disabled={uploading > 0} onClick={() => input.current?.click()}>
              <CameraIcon size={18} /> {uploading > 0 ? `Загружаю: ${uploading}` : "Добавить фото"}
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
          title={view === "gallery" ? "Фото пока нет" : "В записях пока нет фото"}
          text={
            view === "gallery"
              ? "Добавь первое фото машины: оно сохранится в папку «Галерея» на твоём Google Диске."
              : "Прикрепляй чеки и заказ-наряды прямо в форме записи: они попадут в папку «Скриншоты»."
          }
        />
      ) : (
        <div className="photo-wall">
          {list.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="photo-tile"
              aria-label={`Открыть фото ${p.name}`}
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
