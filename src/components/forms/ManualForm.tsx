import { useId, useRef, useState, type FormEvent } from "react";
import { LIMITS } from "../../../shared/constants";
import { genId, hostOf, todayISO } from "../../../shared/format";
import { normalizeUrl } from "../../../shared/parse";
import type { Manual, ManualResponse } from "../../../shared/types";
import { errorText, postForm } from "../../lib/api";
import { addManuals, closeDialog, dispatch, flush, resolveCarId, toast, useStore, useT } from "../../lib/store";
import { Modal } from "../Modal";
import { CarSelect, Field, FormFooter } from "./common";

type Kind = "link" | "file" | "note";

/** Матеріал для машини: посилання, файл або просто нотатка. Файл після завантаження змінити не можна, лише назву й нотатку. */
export function ManualForm({ manual, car: carHint }: { manual?: Manual; car?: string }) {
  const t = useT();
  const active = useStore((s) => s.active);
  const cars = useStore((s) => s.data.cars);
  const [car, setCar] = useState(manual?.car ?? carHint ?? active ?? cars[0]?.id ?? "");
  const [kind, setKind] = useState<Kind>(manual ? (manual.file ? "file" : manual.url ? "link" : "note") : "link");
  const [title, setTitle] = useState(manual?.title ?? "");
  const [url, setUrl] = useState(manual?.url ?? "");
  const [note, setNote] = useState(manual?.note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const kindId = useId();

  const kinds: [Kind, string][] = [
    ["link", t.manualForm.kindLink],
    ["file", t.manualForm.kindFile],
    ["note", t.manualForm.kindNote],
  ];

  const save = (data: Omit<Manual, "file">) => {
    dispatch({ type: "manual.put", data });
    closeDialog();
    toast(t.common.saved);
  };

  const upload = async (picked: File) => {
    setBusy(true);
    try {
      await flush();
      const form = new FormData();
      form.set("id", genId());
      form.set("car", resolveCarId(car));
      form.set("title", title.trim() || picked.name);
      form.set("note", note.trim());
      form.set("file", picked, picked.name);
      const { manual: created } = await postForm<ManualResponse>("/api/manuals/file", form);
      addManuals([created]);
      closeDialog();
      toast(t.common.saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    const base = { id: manual?.id ?? genId(), car, note: note.trim(), added: manual?.added ?? todayISO() };

    if (kind === "file") {
      if (manual) {
        if (!title.trim()) return setError(t.manualForm.errTitle);
        return save({ ...base, title: title.trim(), url: null });
      }
      if (!file) return setError(t.manualForm.errFile);
      if (file.size > LIMITS.uploadBytes) return setError(t.manualForm.errTooBig(file.name));
      return void upload(file);
    }
    if (kind === "link") {
      const normalized = normalizeUrl(url);
      if (!normalized) return setError(t.manualForm.errUrl);
      return save({ ...base, title: title.trim() || hostOf(normalized), url: normalized });
    }
    if (!title.trim()) return setError(t.manualForm.errTitle);
    save({ ...base, title: title.trim(), url: null });
  };

  const remove = () => {
    if (!manual) return;
    dispatch({ type: "manual.del", id: manual.id });
    closeDialog();
    toast(t.manualForm.deleted);
  };

  return (
    <Modal title={manual ? t.manualForm.titleEdit : t.manualForm.titleNew} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <CarSelect value={car} onChange={setCar} />
        {!manual && (
          <div className="field">
            <span className="field-label" id={kindId}>
              {t.manualForm.kindAria}
            </span>
            <div className="chip-grid" role="group" aria-labelledby={kindId}>
              {kinds.map(([k, label]) => (
                <button key={k} type="button" className={`pick${kind === k ? " is-on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {kind === "file" && !manual && (
          <Field label={t.manualForm.file} hint={file ? file.name : t.manualForm.fileHint}>
            <button type="button" className="btn btn-quiet" onClick={() => input.current?.click()}>
              {t.manualForm.chooseFile}
            </button>
            <input
              ref={input}
              type="file"
              hidden
              aria-label={t.manualForm.file}
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null;
                setFile(picked);
                if (picked && !title.trim()) setTitle(picked.name);
              }}
            />
          </Field>
        )}
        <Field label={t.manualForm.title}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.manualForm.titlePlaceholder}
            maxLength={LIMITS.titleLength}
          />
        </Field>
        {kind === "link" && (
          <Field label={t.manualForm.url}>
            <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" maxLength={LIMITS.urlLength} />
          </Field>
        )}
        <Field label={t.manualForm.note}>
          <textarea rows={kind === "note" ? 5 : 2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.noteLength} />
        </Field>
        <FormFooter
          error={error}
          onDelete={manual ? remove : undefined}
          deleteQuestion={t.manualForm.deleteQ}
          submitLabel={busy ? t.manualForm.uploading : undefined}
        />
      </form>
    </Modal>
  );
}
