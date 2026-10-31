import { useRef, useState } from "react";
import { BACKUP_ERRORS, backupFileName, backupToText, buildBackup, parseBackupText } from "../../shared/backup";
import { LIMITS } from "../../shared/constants";
import { nameKey, todayISO } from "../../shared/format";
import { buildSheets } from "../../shared/sheet";
import type { SheetExportResponse, SheetImportResponse } from "../../shared/types";
import { HttpError, errorText, postJson } from "../lib/api";
import { downloadFile } from "../lib/download";
import { applyBackup, dispatch, flush, getState, openDialog, setDrive, toast, useStore } from "../lib/store";

const handleDriveError = (err: unknown): void => {
  if (err instanceof HttpError && err.code === "drive_disconnected") {
    setDrive({ ...getState().drive, connected: false });
  }
  toast(errorText(err));
};

function BackupCard() {
  const data = useStore((s) => s.data);
  const activeCar = useStore((s) => s.data.cars.find((c) => c.id === s.active));
  const today = todayISO();

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Скопировано");
    } catch {
      openDialog({ type: "copy", text });
    }
  };

  return (
    <section className="sheet data-sheet">
      <h2 className="sheet-title">Файл-бэкап</h2>
      <p className="muted">
        Текстовый файл со всеми записями. Хранить его не обязательно, но он пригодится, чтобы перенести гараж или
        передать машину другу.
      </p>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-ink"
          onClick={() => {
            downloadFile(backupFileName(today), backupToText(buildBackup(data)), "text/plain;charset=utf-8");
            toast("Файл сохранён");
          }}
        >
          Скачать весь гараж
        </button>
        {activeCar && (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              downloadFile(
                backupFileName(today, activeCar.name),
                backupToText(buildBackup(data, activeCar.id)),
                "text/plain;charset=utf-8",
              );
              toast("Файл сохранён");
            }}
          >
            Только «{activeCar.name}»
          </button>
        )}
        <button type="button" className="btn btn-quiet" onClick={() => void copy(backupToText(buildBackup(data)))}>
          Скопировать весь гараж
        </button>
      </div>
    </section>
  );
}

function RestoreCard() {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const restore = (raw: string) => {
    const parsed = parseBackupText(raw);
    if (!parsed.ok) {
      setMessage({ text: parsed.error, bad: true });
      return;
    }
    setMessage({ text: applyBackup(parsed.backup), bad: false });
    setText("");
  };

  return (
    <section className="sheet data-sheet">
      <h2 className="sheet-title">Восстановить из бэкапа</h2>
      <p className="muted">Записи добавятся к тем, что уже есть. Повторы пропускаются.</p>
      <div className="btn-row">
        <button type="button" className="btn btn-ink" onClick={() => file.current?.click()}>
          Из файла бэкапа…
        </button>
        <input
          ref={file}
          type="file"
          accept=".txt,.json,text/plain,application/json"
          hidden
          aria-label="Файл бэкапа"
          onChange={async (e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            if (!picked) return;
            try {
              restore(await picked.text());
            } catch {
              setMessage({ text: BACKUP_ERRORS.file, bad: true });
            }
          }}
        />
      </div>
      <label className="field">
        <span className="field-label">Или вставь текст бэкапа</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      </label>
      <div className="btn-row">
        <button type="button" className="btn btn-quiet" disabled={!text.trim()} onClick={() => restore(text)}>
          Загрузить
        </button>
      </div>
      {message && (
        <p className={message.bad ? "form-error" : "form-ok"} role={message.bad ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </section>
  );
}

function SheetCard() {
  const data = useStore((s) => s.data);
  const drive = useStore((s) => s.drive);
  const driveEnabled = useStore((s) => s.config.drive);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [message, setMessage] = useState("");

  const exportSheet = async () => {
    setBusy("export");
    setMessage("");
    try {
      await flush();
      const res = await postJson<SheetExportResponse>("/api/google/sheet/export");
      setDrive({ ...getState().drive, sheetUrl: res.url, sheetExportedAt: res.exportedAt });
      toast("Таблица обновлена");
    } catch (err) {
      handleDriveError(err);
    } finally {
      setBusy(null);
    }
  };

  const importSheet = async () => {
    setBusy("import");
    setMessage("");
    try {
      await flush();
      const res = await postJson<SheetImportResponse>("/api/google/sheet/import");
      setMessage(applyBackup(res.backup));
    } catch (err) {
      handleDriveError(err);
    } finally {
      setBusy(null);
    }
  };

  const downloadXlsx = async () => {
    const { buildXlsx } = await import("../lib/xlsx");
    const today = todayISO();
    const bytes = buildXlsx(buildSheets(data, today));
    downloadFile(
      `garage-${today}.xlsx`,
      new Uint8Array(bytes),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    toast("Файл сохранён");
  };

  return (
    <section className="sheet data-sheet">
      <h2 className="sheet-title">Таблица</h2>
      <p className="muted">
        Все числа считает сам сайт и записывает готовыми значениями, без формул. Поэтому суммы и расход в таблице
        совпадают с сайтом до копейки, какой бы ни была локаль таблицы.
      </p>
      {driveEnabled && drive.connected && (
        <>
          <div className="btn-row">
            <button type="button" className="btn btn-ink" disabled={busy !== null} onClick={() => void exportSheet()}>
              {busy === "export" ? "Обновляю…" : drive.sheetUrl ? "Обновить Google Таблицу" : "Создать Google Таблицу"}
            </button>
            {drive.sheetUrl && (
              <a className="btn btn-quiet" href={drive.sheetUrl} target="_blank" rel="noreferrer">
                Открыть таблицу
              </a>
            )}
            {drive.sheetUrl && (
              <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void importSheet()}>
                {busy === "import" ? "Загружаю…" : "Восстановить из таблицы"}
              </button>
            )}
          </div>
          {drive.sheetExportedAt && (
            <p className="muted">Обновлена {new Date(drive.sheetExportedAt * 1000).toLocaleString("ru-RU")}</p>
          )}
          {message && (
            <p className="form-ok" role="status">
              {message}
            </p>
          )}
        </>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn-quiet" onClick={() => void downloadXlsx()}>
          Скачать таблицу .xlsx
        </button>
      </div>
    </section>
  );
}

function DriveCard() {
  const drive = useStore((s) => s.drive);
  const driveEnabled = useStore((s) => s.config.drive);
  const [asking, setAsking] = useState(false);
  if (!driveEnabled) return null;

  const disconnect = async () => {
    try {
      await postJson("/api/google/drive/disconnect");
      setDrive({ connected: false, email: null, sheetUrl: null, sheetExportedAt: null });
      toast("Google Диск отключён");
    } catch (err) {
      toast(errorText(err));
    }
    setAsking(false);
  };

  return (
    <section className="sheet data-sheet">
      <h2 className="sheet-title">Google Диск</h2>
      <p className="muted">
        Фото и скриншоты хранятся в твоей папке «Гараж Амедро», а в базе сайта только ссылки на них. Сайт видит лишь
        файлы, которые создал сам, а остальной Диск ему недоступен. Отозвать доступ можно здесь или в настройках
        аккаунта Google.
      </p>
      {drive.connected ? (
        <>
          <p>
            Подключён
            {drive.email ? (
              <>
                : <b>{drive.email}</b>
              </>
            ) : null}
          </p>
          {asking ? (
            <div className="confirm-block">
              <p>Файлы останутся на твоём Диске, но на сайте фото перестанут открываться, пока Диск снова не подключён.</p>
              <div className="btn-row">
                <button type="button" className="btn btn-danger" onClick={() => void disconnect()}>
                  Да, отключить
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setAsking(false)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => setAsking(true)}>
              Отключить Диск
            </button>
          )}
        </>
      ) : (
        <a className="btn btn-ink" href="/api/google/drive/connect">
          Подключить Google Диск
        </a>
      )}
    </section>
  );
}

function CarRow({ id, name }: { id: string; name: string }) {
  const cars = useStore((s) => s.data.cars);
  const [value, setValue] = useState(name);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  const save = () => {
    const next = value.trim();
    if (!next) return setError("Напиши название.");
    if (cars.some((c) => c.id !== id && nameKey(c.name) === nameKey(next))) return setError("Такая машина уже есть.");
    setError("");
    dispatch({ type: "car.put", data: { id, name: next } });
    toast("Сохранено");
  };

  return (
    <li className="car-row">
      <input
        aria-label="Название машины"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={LIMITS.carNameLength}
      />
      <div className="btn-row">
        <button type="button" className="btn btn-quiet btn-small" disabled={value.trim() === name} onClick={save}>
          Сохранить
        </button>
        {asking ? (
          <button
            type="button"
            className="btn btn-danger btn-small"
            onClick={() => {
              dispatch({ type: "car.del", id });
              toast("Машина удалена");
            }}
          >
            Удалить машину и все её записи
          </button>
        ) : (
          <button type="button" className="btn btn-danger-quiet btn-small" onClick={() => setAsking(true)}>
            Удалить
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function CarsCard() {
  const cars = useStore((s) => s.data.cars);
  return (
    <section className="sheet data-sheet">
      <h2 className="sheet-title">Машины и настройки</h2>
      <ul className="car-rows">
        {cars.map((c) => (
          <CarRow key={c.id} id={c.id} name={c.name} />
        ))}
      </ul>
      <button type="button" className="btn btn-quiet" onClick={() => openDialog({ type: "car" })}>
        Добавить машину
      </button>
    </section>
  );
}

function WipeCard() {
  const [asking, setAsking] = useState(false);
  return (
    <section className="data-wipe">
      {asking ? (
        <div className="confirm-block">
          <p>Все машины и записи исчезнут из аккаунта на всех устройствах. Файлы на Google Диске останутся.</p>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                dispatch({ type: "all.del" });
                setAsking(false);
                toast("Все данные стёрты");
              }}
            >
              Да, стереть
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setAsking(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-danger-quiet" onClick={() => setAsking(true)}>
          Стереть все данные
        </button>
      )}
    </section>
  );
}

export function DataTab() {
  return (
    <div className="data">
      <section className="sheet data-sheet">
        <h2 className="sheet-title">Где хранятся записи</h2>
        <p className="muted">
          В твоём аккаунте на сервере сайта. Заходи с любого устройства: бэкапы делать не обязательно. Без интернета
          записи тоже сохраняются и отправляются сами, когда связь появится.
        </p>
      </section>
      <BackupCard />
      <RestoreCard />
      <SheetCard />
      <DriveCard />
      <CarsCard />
      <WipeCard />
    </div>
  );
}
