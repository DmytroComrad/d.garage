import { useRef, useState } from "react";
import { photoUrl, uploadPhotos } from "../lib/photos";
import { carRecords, openDialog, setTab, useApp } from "../lib/store";
import { CameraIcon } from "./icons";

export function GalleryTab({ carId }: { carId: string }) {
  const { data, drive, config, uploading } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"gallery" | "record">("gallery");
  const { photos } = carRecords(data, carId);
  const list = photos.filter((p) => p.kind === view).sort((a, b) => b.createdAt - a.createdAt);
  const shots = photos.filter((p) => p.kind === "record").length;

  if (!config.drive) {
    return (
      <div className="empty narrow">
        <h2>Галерея пока недоступна</h2>
        <p>Фото будут храниться на твоём Google Диске. Подключение появится здесь, как только его настроят на сайте.</p>
      </div>
    );
  }

  if (!drive.connected) {
    return (
      <div className="empty narrow">
        <h2>Подключи Google Диск</h2>
        <p>
          Фото машины и скриншоты чеков будут лежать в отдельной папке на твоём Диске. Сайт получает доступ только к
          тем файлам, которые загрузил сам: остальное на Диске он не видит.
        </p>
        <a className="btn btn-ink" href="/api/google/drive/connect">
          Подключить Google Диск
        </a>
        <button type="button" className="link-btn" onClick={() => setTab("data")}>
          Подробнее на вкладке «Данные»
        </button>
      </div>
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
        <div className="empty">
          <h2>{view === "gallery" ? "Фото пока нет" : "В записях пока нет фото"}</h2>
          <p>
            {view === "gallery"
              ? "Добавь первое фото машины: оно сохранится в папку «Галерея» на твоём Google Диске."
              : "Прикрепляй чеки и заказ-наряды прямо в форме записи: они попадут в папку «Скриншоты»."}
          </p>
        </div>
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
