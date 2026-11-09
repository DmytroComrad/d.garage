import { useMemo, useRef, useState } from "react";
import {
  buildVCard,
  contactFromPicker,
  filterContacts,
  shortUrl,
  sortContacts,
  telHref,
  vcardFileName,
  type PickedContact,
} from "../../shared/contacts";
import { LOCALES } from "../../shared/i18n";
import type { ContactEntry } from "../../shared/types";
import { errorText } from "../lib/api";
import { downloadFile } from "../lib/download";
import { closeDialog, dispatch, openDialog, shareContact, toast, unshareContact, useStore, useT } from "../lib/store";
import { ConfirmDelete } from "./forms/common";
import { DownloadIcon, LinkIcon, MailIcon, PencilIcon, PhoneIcon, ShareIcon } from "./icons";
import { EmptyState } from "./Ledger";
import { Modal } from "./Modal";

/** Contact Picker API: є лише в Chrome на Android. Деінде кнопки просто немає. */
type ContactsManager = { select: (props: string[], opts?: { multiple?: boolean }) => Promise<PickedContact[]> };

const contactPicker = (): ContactsManager | null => {
  const contacts = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
  return contacts && typeof contacts.select === "function" && "ContactsManager" in window ? contacts : null;
};

/** Пошук з'являється, коли контактів стає більше, ніж видно на екрані. */
const SEARCH_FROM = 6;

const saveToPhone = (c: ContactEntry): void =>
  downloadFile(vcardFileName(c.name), buildVCard(c), "text/vcard;charset=utf-8");

function ContactCard({ contact }: { contact: ContactEntry }) {
  const t = useT();
  return (
    <article className="contact">
      <div className="contact-head">
        <div className="contact-title">
          <h3 className="contact-name">{contact.name}</h3>
          {contact.role && <p className="contact-role">{contact.role}</p>}
        </div>
        {contact.shared && <span className="tag tag-share">{t.contacts.sharedTag}</span>}
      </div>
      {(contact.phone || contact.email || contact.link) && (
        <ul className="contact-ways">
          {contact.phone && (
            <li>
              <a href={telHref(contact.phone)} title={t.contacts.call(contact.name)}>
                <PhoneIcon size={16} />
                <span className="num">{contact.phone}</span>
              </a>
            </li>
          )}
          {contact.email && (
            <li>
              <a href={`mailto:${contact.email}`} title={t.contacts.write(contact.name)}>
                <MailIcon size={16} />
                <span>{contact.email}</span>
              </a>
            </li>
          )}
          {contact.link && (
            <li>
              <a href={contact.link} target="_blank" rel="noopener noreferrer nofollow">
                <LinkIcon size={16} />
                <span>{shortUrl(contact.link)}</span>
              </a>
            </li>
          )}
        </ul>
      )}
      {contact.note && <p className="contact-note">{contact.note}</p>}
      <div className="contact-actions">
        <button type="button" className="btn btn-small btn-quiet" onClick={() => saveToPhone(contact)}>
          <DownloadIcon size={16} /> {t.contacts.save}
        </button>
        <button
          type="button"
          className="btn btn-small btn-quiet"
          onClick={() => openDialog({ type: "contactShare", contactId: contact.id })}
        >
          <ShareIcon size={16} /> {t.contacts.share}
        </button>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => openDialog({ type: "contact", contact })}>
          <PencilIcon size={16} /> {t.contacts.edit}
        </button>
        <ConfirmDelete
          question={t.contacts.deleteQ}
          onDelete={() => {
            dispatch({ type: "contact.del", id: contact.id });
            toast(t.contacts.deleted);
          }}
        />
      </div>
    </article>
  );
}

export function ContactsTab({ carId }: { carId: string }) {
  const t = useT();
  const all = useStore((s) => s.data.contacts);
  const lang = useStore((s) => s.prefs.lang);
  const [query, setQuery] = useState("");
  const contacts = useMemo(
    () => sortContacts(all.filter((c) => c.car === carId), new Intl.Collator(LOCALES[lang])),
    [all, carId, lang],
  );
  const searchable = contacts.length >= SEARCH_FROM;
  const shown = searchable ? filterContacts(contacts, query) : contacts;
  const picker = contactPicker();

  const pick = async () => {
    if (!picker) return;
    try {
      const [picked] = await picker.select(["name", "tel", "email"], { multiple: false });
      if (picked) openDialog({ type: "contact", draft: contactFromPicker(picked) });
    } catch {
      toast(t.contacts.pickFailed);
    }
  };

  return (
    <div className="narrow">
      <div className="section-head">
        <p className="muted">{t.contacts.hint}</p>
        <div className="btn-row">
          {picker && (
            <button type="button" className="btn btn-quiet" onClick={() => void pick()}>
              {t.contacts.fromPhone}
            </button>
          )}
          <button type="button" className="btn btn-ink" onClick={() => openDialog({ type: "contact" })}>
            {t.contacts.add}
          </button>
        </div>
      </div>

      {contacts.length === 0 ? (
        <EmptyState title={t.contacts.emptyTitle} text={t.contacts.emptyText} />
      ) : (
        <>
          {searchable && (
            <div className="contact-search">
              <input
                type="search"
                aria-label={t.contacts.search}
                placeholder={t.contacts.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="muted">{t.contacts.count(contacts.length)}</span>
            </div>
          )}
          {shown.length === 0 ? (
            <p className="muted">{t.contacts.nothing}</p>
          ) : (
            <div className="sheet ledger">
              {shown.map((c) => (
                <ContactCard key={c.id} contact={c} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Посилання на один контакт. Сервер показує його лише раз, при створенні: зберігає він тільки хеш.
 * Тому після перезавантаження можна лише видати нове (старе перестане працювати) або вимкнути.
 */
export function ContactShareDialog({ contactId }: { contactId: string }) {
  const t = useT();
  const s = t.contactShare;
  const contact = useStore((st) => st.data.contacts.find((c) => c.id === contactId));
  const url = useStore((st) => st.shareLinks[contactId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  if (!contact) return null;

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
      toast(done);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast(t.common.copied);
    } catch {
      // Без доступу до буфера: виділяємо посилання, далі людина скопіює сама.
      input.current?.select();
    }
  };

  const send = () => {
    if (url) void navigator.share?.({ title: contact.name, url }).catch(() => undefined);
  };

  return (
    <Modal title={s.title} onClose={() => closeDialog()}>
      <div className="share">
        {url ? (
          <>
            <p className="dialog-text">{s.onText}</p>
            <label className="field">
              <span className="field-label">{s.link}</span>
              <span className="input-with-action">
                <input ref={input} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="input-action" onClick={() => void copy()}>
                  {s.copy}
                </button>
              </span>
            </label>
            {typeof navigator.share === "function" && (
              <div className="btn-row">
                <button type="button" className="btn btn-quiet" onClick={send}>
                  <ShareIcon size={16} /> {s.send}
                </button>
              </div>
            )}
          </>
        ) : contact.shared ? (
          <>
            <p className="dialog-text">{s.hiddenText}</p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-ink"
                disabled={busy}
                onClick={() => void run(() => shareContact(contactId), s.created)}
              >
                {s.newLink}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="dialog-text">{s.offText(contact.name)}</p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-ink"
                disabled={busy}
                onClick={() => void run(() => shareContact(contactId), s.created)}
              >
                {s.create}
              </button>
            </div>
          </>
        )}
        <p className="muted">{s.consent}</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          {contact.shared && (
            <button
              type="button"
              className="btn btn-danger-quiet"
              disabled={busy}
              onClick={() => void run(() => unshareContact(contactId), s.turnedOff)}
            >
              {s.turnOff}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className={`btn ${url ? "btn-ink" : "btn-quiet"}`} onClick={() => closeDialog()}>
            {t.common.done}
          </button>
        </div>
      </div>
    </Modal>
  );
}
