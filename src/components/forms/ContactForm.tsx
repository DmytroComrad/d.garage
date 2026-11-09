import { useState, type FormEvent } from "react";
import { LIMITS } from "../../../shared/constants";
import type { ContactDraft } from "../../../shared/contacts";
import { genId } from "../../../shared/format";
import { isEmailAddress, isPhone, normalizeContactLink } from "../../../shared/parse";
import type { ContactEntry } from "../../../shared/types";
import { closeDialog, dispatch, toast, useStore, useT } from "../../lib/store";
import { Modal } from "../Modal";
import { CarSelect, Field, FormFooter } from "./common";

/** Контакт: обов'язкове лише ім'я. Номер, пошту й посилання перевіряємо так само, як сервер. */
export function ContactForm({ contact, draft }: { contact?: ContactEntry; draft?: ContactDraft }) {
  const t = useT();
  const f = t.contactForm;
  const active = useStore((s) => s.active);
  const cars = useStore((s) => s.data.cars);
  const [car, setCar] = useState(contact?.car ?? active ?? cars[0]?.id ?? "");
  const [name, setName] = useState(contact?.name ?? draft?.name ?? "");
  const [role, setRole] = useState(contact?.role ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? draft?.phone ?? "");
  const [email, setEmail] = useState(contact?.email ?? draft?.email ?? "");
  const [link, setLink] = useState(contact?.link ?? "");
  const [note, setNote] = useState(contact?.note ?? "");
  const [error, setError] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(f.errName);
    const cleanPhone = phone.trim();
    if (cleanPhone && !isPhone(cleanPhone)) return setError(f.errPhone);
    const cleanEmail = email.trim();
    if (cleanEmail && !isEmailAddress(cleanEmail)) return setError(f.errEmail);
    const url = link.trim() ? normalizeContactLink(link) : "";
    if (url === null) return setError(f.errLink);

    dispatch({
      type: "contact.put",
      data: {
        id: contact?.id ?? genId(),
        car,
        name: name.trim(),
        role: role.trim(),
        phone: cleanPhone,
        email: cleanEmail,
        link: url,
        note: note.trim(),
      },
    });
    closeDialog();
    toast(t.common.saved);
  };

  const remove = () => {
    if (!contact) return;
    dispatch({ type: "contact.del", id: contact.id });
    closeDialog();
    toast(t.contacts.deleted);
  };

  return (
    <Modal title={contact ? f.titleEdit : f.titleNew} onClose={() => closeDialog()}>
      <form onSubmit={submit} noValidate>
        <CarSelect value={car} onChange={setCar} />
        <Field label={f.name}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={f.namePlaceholder}
            maxLength={LIMITS.contactNameLength}
            autoComplete="off"
          />
        </Field>
        <Field label={f.role}>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder={f.rolePlaceholder}
            maxLength={LIMITS.contactRoleLength}
          />
        </Field>
        <div className="field-row">
          <Field label={f.phone}>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={LIMITS.phoneLength}
            />
          </Field>
          <Field label={f.email}>
            <input
              inputMode="email"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={LIMITS.emailLength}
            />
          </Field>
        </div>
        <Field label={f.link} hint={f.linkHint}>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="off"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://…"
            maxLength={LIMITS.urlLength}
          />
        </Field>
        <Field label={f.note}>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.noteLength} />
        </Field>
        <FormFooter error={error} onDelete={contact ? remove : undefined} deleteQuestion={t.contacts.deleteQ} />
      </form>
    </Modal>
  );
}
