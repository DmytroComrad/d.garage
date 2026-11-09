import { useEffect, useState } from "react";
import { fmtFileSize, hostOf } from "../../shared/format";
import type { ImportManualsResponse, ManualShareResponse, SharedManualsResponse } from "../../shared/types";
import { errorText, getJson, postJson } from "../lib/api";
import { addManuals, closeDialog, openDialog, setActive, setTab, toast, useStore, useT } from "../lib/store";
import { CarSelect } from "./forms/common";
import { Modal } from "./Modal";

/** Посилання на мануали машини: створити, скопіювати, вимкнути. */
export function ManualShareDialog({ car }: { car: string }) {
  const t = useT();
  const carName = useStore((s) => s.data.cars.find((c) => c.id === car)?.name ?? "");
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    getJson<ManualShareResponse>(`/api/manuals/share?car=${encodeURIComponent(car)}`)
      .then((res) => setUrl(res.url))
      .catch((err) => setError(errorText(err)));
  }, [car]);

  const run = async (action: () => Promise<ManualShareResponse>, done?: string) => {
    setError("");
    try {
      setUrl((await action()).url);
      if (done) toast(done);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t.manualShare.copied);
    } catch {
      openDialog({ type: "copy", text });
    }
  };

  return (
    <Modal title={t.manualShare.title} onClose={() => closeDialog()}>
      <p className="dialog-text">{t.manualShare.text(carName)}</p>
      {url && <input className="share-url" readOnly value={url} aria-label={t.manualShare.title} onFocus={(e) => e.target.select()} />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        {url && (
          <button type="button" className="btn btn-danger-quiet" onClick={() => void run(() => postJson("/api/manuals/unshare", { car }), t.manualShare.stopped)}>
            {t.manualShare.stop}
          </button>
        )}
        <span className="spacer" />
        {url === null && (
          <button type="button" className="btn btn-ink" onClick={() => void run(() => postJson("/api/manuals/share", { car }))}>
            {t.manualShare.create}
          </button>
        )}
        {url && (
          <button type="button" className="btn btn-ink" onClick={() => void copy(url)}>
            {t.manualShare.copy}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Чужі мануали за посиланням: вибрати потрібні й скопіювати у свою машину. */
export function SharedManualsDialog({ token }: { token: string }) {
  const t = useT();
  const cars = useStore((s) => s.data.cars);
  const active = useStore((s) => s.active);
  const [car, setCar] = useState(active ?? cars[0]?.id ?? "");
  const [shared, setShared] = useState<SharedManualsResponse | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getJson<SharedManualsResponse>(`/api/manuals/shared/${encodeURIComponent(token)}`)
      .then((res) => {
        setShared(res);
        setPicked(new Set(res.items.map((m) => m.id)));
      })
      .catch((err) => setError(errorText(err)));
  }, [token]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await postJson<ImportManualsResponse>(`/api/manuals/shared/${encodeURIComponent(token)}/import`, {
        car,
        ids: [...picked],
      });
      addManuals(res.manuals);
      closeDialog();
      setActive(car);
      setTab("manuals");
      toast(t.sharedManuals.added(res.manuals.length));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={shared ? t.sharedManuals.title(shared.carName) : t.manualShare.title} onClose={() => closeDialog()}>
      {shared && (
        <>
          <p className="dialog-text">{shared.own ? t.sharedManuals.own : t.sharedManuals.text}</p>
          {shared.items.length === 0 ? (
            <p className="muted">{t.sharedManuals.empty}</p>
          ) : (
            <ul className="shared-list">
              {shared.items.map((m) => (
                <li key={m.id}>
                  <label className="check">
                    <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
                    <span>
                      <b>{m.title}</b>
                      <span className="rec-meta">
                        {m.file ? `${m.file.name} · ${fmtFileSize(m.file.size)}` : m.url ? hostOf(m.url) : t.manuals.noteKind}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {cars.length === 0 ? <p className="muted">{t.sharedManuals.noCar}</p> : <CarSelect value={car} onChange={setCar} />}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" onClick={() => closeDialog()}>
          {t.common.cancel}
        </button>
        {shared && shared.items.length > 0 && cars.length > 0 && (
          <button type="button" className="btn btn-ink" disabled={busy || picked.size === 0} onClick={() => void add()}>
            {t.sharedManuals.add(picked.size)}
          </button>
        )}
      </div>
    </Modal>
  );
}
