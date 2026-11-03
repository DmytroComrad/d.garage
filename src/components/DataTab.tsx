import { useEffect, useRef, useState, type DragEvent } from "react";
import { backupFileName, backupToText, buildBackup, parseBackupText } from "../../shared/backup";
import { LIMITS } from "../../shared/constants";
import { fmtDateTime, nameKey, todayISO } from "../../shared/format";
import { buildSheets } from "../../shared/sheet";
import type { SheetExportResponse, SheetImportResponse } from "../../shared/types";
import { HttpError, errorText, postJson } from "../lib/api";
import { downloadFile } from "../lib/download";
import {
  applyBackup,
  dispatch,
  flush,
  getState,
  googleHref,
  openDialog,
  setDrive,
  toast,
  useStore,
  useT,
} from "../lib/store";

const handleDriveError = (err: unknown): void => {
  if (err instanceof HttpError && err.code === "drive_disconnected") {
    setDrive({ ...getState().drive, connected: false });
  }
  toast(errorText(err));
};

function BackupCard() {
  const t = useT();
  const data = useStore((s) => s.data);
  const activeCar = useStore((s) => s.data.cars.find((c) => c.id === s.active));
  const today = todayISO();

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t.common.copied);
    } catch {
      openDialog({ type: "copy", text });
    }
  };

  return (
    <section className="sheet data-sheet">
      <h2 className="sheet-title">{t.data.backupTitle}</h2>
      <p className="muted">{t.data.backupText}</p>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-ink"
          onClick={() => {
            downloadFile(backupFileName(today), backupToText(buildBackup(data)), "text/plain;charset=utf-8");
            toast(t.common.fileSaved);
          }}
        >
          {t.data.downloadAll}
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
              toast(t.common.fileSaved);
            }}
          >
            {t.data.onlyCar(activeCar.name)}
          </button>
        )}
        <button type="button" className="btn btn-quiet" onClick={() => void copy(backupToText(buildBackup(data)))}>
          {t.data.copyAll}
        </button>
      </div>
    </section>
  );
}

const hasFiles = (e: DragEvent): boolean => e.dataTransfer.types.includes("Files");

/** Бекап можна вибрати кнопкою, перетягнути файлом на картку або вставити текстом. */
function RestoreCard() {
  const t = useT();
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const file = useRef<HTMLInputElement>(null);

  // Файл, кинутий повз картку, браузер відкрив би замість сайту: на цій вкладці такого не буває.
  useEffect(() => {
    const block = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const restore = (raw: string) => {
    const parsed = parseBackupText(raw);
    if (!parsed.ok) {
      setMessage({ text: parsed.error === "corrupted" ? t.data.errCorrupted : t.data.errNotBackup, bad: true });
      return;
    }
    const result = applyBackup(parsed.backup);
    setMessage({ text: t.data.result(result.added, result.skipped), bad: false });
    setText("");
  };

  const readFile = async (picked: File | undefined) => {
    if (!picked) return;
    try {
      restore(await picked.text());
    } catch {
      setMessage({ text: t.data.errFile, bad: true });
    }
  };

  return (
    <section
      className={`sheet data-sheet dropzone${dragging ? " is-drag" : ""}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        void readFile(e.dataTransfer.files[0]);
      }}
    >
      <h2 className="sheet-title">{t.data.restoreTitle}</h2>
      <p className="muted">{t.data.restoreText}</p>
      <div className="drop-area">
        <span className="drop-hint">{t.data.dropHint}</span>
        <button type="button" className="btn btn-ink" onClick={() => file.current?.click()}>
          {t.data.pick}
        </button>
        <input
          ref={file}
          type="file"
          accept=".txt,.json,text/plain,application/json"
          hidden
          aria-label={t.data.fileInput}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            void readFile(picked);
          }}
        />
      </div>
      <label className="field">
        <span className="field-label">{t.data.pasteLabel}</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      </label>
      <div className="btn-row">
        <button type="button" className="btn btn-quiet" disabled={!text.trim()} onClick={() => restore(text)}>
          {t.data.load}
        </button>
      </div>
      {message && (
        <p className={message.bad ? "form-error" : "form-ok"} role={message.bad ? "alert" : "status"}>
          {message.text}
        </p>
      )}
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          {t.data.dropNow}
        </div>
      )}
    </section>
  );
}

function SheetCard() {
  const t = useT();
  const data = useStore((s) => s.data);
  const drive = useStore((s) => s.drive);
  const driveEnabled = useStore((s) => s.config.drive);
  const prefs = useStore((s) => s.prefs);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [message, setMessage] = useState("");

  const exportSheet = async () => {
    setBusy("export");
    setMessage("");
    try {
      await flush();
      const res = await postJson<SheetExportResponse>("/api/google/sheet/export", { dateFormat: prefs.dateFormat });
      setDrive({ ...getState().drive, sheetUrl: res.url, sheetExportedAt: res.exportedAt });
      toast(t.data.sheetUpdated);
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
      const result = applyBackup(res.backup);
      setMessage(t.data.result(result.added, result.skipped));
    } catch (err) {
      handleDriveError(err);
    } finally {
      setBusy(null);
    }
  };

  const downloadXlsx = async () => {
    const { buildXlsx } = await import("../lib/xlsx");
    const today = todayISO();
    const bytes = buildXlsx(buildSheets(data, today, prefs.lang), prefs.dateFormat);
    downloadFile(
      `d-garage-${today}.xlsx`,
      new Uint8Array(bytes),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    toast(t.common.fileSaved);
  };

  return (
    <section className="sheet data-sheet">
      <h2 className="sheet-title">{t.data.sheetTitle}</h2>
      <p className="muted">{t.data.sheetText}</p>
      {driveEnabled && drive.connected && (
        <>
          <div className="btn-row">
            <button type="button" className="btn btn-ink" disabled={busy !== null} onClick={() => void exportSheet()}>
              {busy === "export" ? t.data.updating : drive.sheetUrl ? t.data.update : t.data.create}
            </button>
            {drive.sheetUrl && (
              <a className="btn btn-quiet" href={drive.sheetUrl} target="_blank" rel="noreferrer">
                {t.data.open}
              </a>
            )}
            {drive.sheetUrl && (
              <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void importSheet()}>
                {busy === "import" ? t.data.loading : t.data.restoreSheet}
              </button>
            )}
          </div>
          {drive.sheetExportedAt && <p className="muted">{t.data.updatedAt(fmtDateTime(drive.sheetExportedAt))}</p>}
          {message && (
            <p className="form-ok" role="status">
              {message}
            </p>
          )}
        </>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn-quiet" onClick={() => void downloadXlsx()}>
          {t.data.xlsx}
        </button>
      </div>
    </section>
  );
}

function DriveCard() {
  const t = useT();
  const drive = useStore((s) => s.drive);
  const driveEnabled = useStore((s) => s.config.drive);
  const [asking, setAsking] = useState(false);
  if (!driveEnabled) return null;

  const disconnect = async () => {
    try {
      await postJson("/api/google/drive/disconnect");
      setDrive({ connected: false, email: null, sheetUrl: null, sheetExportedAt: null });
      toast(t.data.disconnected);
    } catch (err) {
      toast(errorText(err));
    }
    setAsking(false);
  };

  const folders = t.driveFolders;
  return (
    <section className="sheet data-sheet">
      <h2 className="sheet-title">{t.data.driveTitle}</h2>
      <p className="muted">{t.data.driveText(folders.root, folders.gallery, folders.records)}</p>
      {drive.connected ? (
        <>
          <p>
            {t.data.connected}
            {drive.email ? (
              <>
                : <b>{drive.email}</b>
              </>
            ) : null}
          </p>
          {asking ? (
            <div className="confirm-block">
              <p>{t.data.disconnectText}</p>
              <div className="btn-row">
                <button type="button" className="btn btn-danger" onClick={() => void disconnect()}>
                  {t.data.yesDisconnect}
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setAsking(false)}>
                  {t.common.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => setAsking(true)}>
              {t.data.disconnect}
            </button>
          )}
        </>
      ) : (
        <a className="btn btn-ink" href={googleHref("/api/google/drive/connect")}>
          {t.data.connect}
        </a>
      )}
    </section>
  );
}

function CarRow({ id, name }: { id: string; name: string }) {
  const t = useT();
  const cars = useStore((s) => s.data.cars);
  const [value, setValue] = useState(name);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  const save = () => {
    const next = value.trim();
    if (!next) return setError(t.carForm.nameEmpty);
    if (cars.some((c) => c.id !== id && nameKey(c.name) === nameKey(next))) return setError(t.carForm.duplicate);
    setError("");
    dispatch({ type: "car.put", data: { id, name: next } });
    toast(t.common.saved);
  };

  return (
    <li className="car-row">
      <input
        aria-label={t.data.carName}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={LIMITS.carNameLength}
      />
      <div className="btn-row">
        <button type="button" className="btn btn-quiet btn-small" disabled={value.trim() === name} onClick={save}>
          {t.common.save}
        </button>
        {asking ? (
          <button
            type="button"
            className="btn btn-danger btn-small"
            onClick={() => {
              dispatch({ type: "car.del", id });
              toast(t.data.carDeleted);
            }}
          >
            {t.data.deleteCar}
          </button>
        ) : (
          <button type="button" className="btn btn-danger-quiet btn-small" onClick={() => setAsking(true)}>
            {t.common.delete}
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
  const t = useT();
  const cars = useStore((s) => s.data.cars);
  return (
    <section className="sheet data-sheet">
      <h2 className="sheet-title">{t.data.carsTitle}</h2>
      <ul className="car-rows">
        {cars.map((c) => (
          <CarRow key={c.id} id={c.id} name={c.name} />
        ))}
      </ul>
      <button type="button" className="btn btn-quiet" onClick={() => openDialog({ type: "car" })}>
        {t.data.addCar}
      </button>
    </section>
  );
}

function WipeCard() {
  const t = useT();
  const [asking, setAsking] = useState(false);
  return (
    <section className="data-wipe">
      {asking ? (
        <div className="confirm-block">
          <p>{t.data.wipeText}</p>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                dispatch({ type: "all.del" });
                setAsking(false);
                toast(t.data.wiped);
              }}
            >
              {t.data.wipeYes}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setAsking(false)}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-danger-quiet" onClick={() => setAsking(true)}>
          {t.data.wipe}
        </button>
      )}
    </section>
  );
}

export function DataTab() {
  const t = useT();
  return (
    <div className="data">
      <section className="sheet data-sheet">
        <h2 className="sheet-title">{t.data.whereTitle}</h2>
        <p className="muted">{t.data.whereText}</p>
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
