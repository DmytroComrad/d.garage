import { useEffect, useRef, useState } from "react";
import { LIMITS } from "../../shared/constants";
import { formatDate, todayISO } from "../../shared/format";
import { DATE_FORMATS, UNITS } from "../../shared/prefs";
import { reminderText, type RemindersRow } from "../../shared/reminders";
import type { Photo, Wish } from "../../shared/types";
import { del, errorText, postJson } from "../lib/api";
import { driveFileUrl, photoUrl } from "../lib/photos";
import {
  closeDialog,
  googleHref,
  logout,
  markReminderDone,
  removePhoto,
  resetToAnon,
  setPrefs,
  setTab,
  setTheme,
  setUser,
  toast,
  useStore,
  useT,
  type Theme,
} from "../lib/store";
import { CarForm } from "./forms/CarForm";
import { FuelForm } from "./forms/FuelForm";
import { ManualForm } from "./forms/ManualForm";
import { ReminderForm } from "./forms/ReminderForm";
import { ServiceForm } from "./forms/ServiceForm";
import { WishForm } from "./forms/WishForm";
import { ChevronIcon, CloseIcon, LampIcon } from "./icons";
import { ManualShareDialog, SharedManualsDialog } from "./ManualDialogs";
import { Modal } from "./Modal";
import { Mono } from "./Mono";

function NotifyDialog({ rows }: { rows: RemindersRow[] }) {
  const t = useT();
  const [done, setDone] = useState<string[]>([]);
  const worst = Math.max(...rows.map((r) => r.status.level));
  return (
    <Modal title={worst === 3 ? t.notify.urgent : t.notify.soon} onClose={() => closeDialog()} alert>
      <ul className="notify">
        {rows.map(({ reminder, status }) => (
          <li key={reminder.id} className={`lamp lamp-${status.level}`}>
            <span className="lamp-icon">
              <LampIcon />
            </span>
            <span className="lamp-text">
              <Mono text={reminderText(status, reminder.title)} />
            </span>
            {done.includes(reminder.id) ? (
              <span className="muted">{t.notify.done}</span>
            ) : (
              <button
                type="button"
                className="btn btn-small btn-quiet"
                onClick={() => {
                  markReminderDone(reminder);
                  setDone([...done, reminder.id]);
                }}
              >
                {t.notify.done}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            setTab("reminders");
            closeDialog();
          }}
        >
          {t.notify.all}
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-ink" onClick={() => closeDialog()}>
          {t.common.gotIt}
        </button>
      </div>
    </Modal>
  );
}

/** Хотілку щойно позначили виконаною: пропонуємо записати її у витрати. */
function WishDoneDialog({ wish }: { wish: Wish }) {
  const t = useT();
  return (
    <Modal title={t.wishDone.title} onClose={() => closeDialog()}>
      <p className="dialog-text">{t.wishDone.text(wish.title)}</p>
      <div className="form-actions">
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" onClick={() => closeDialog()}>
          {t.wishDone.no}
        </button>
        <button
          type="button"
          className="btn btn-service"
          onClick={() =>
            closeDialog({
              type: "service",
              car: wish.car,
              // Для діапазону точної суми ще немає: її впишуть самі.
              draft: { what: wish.title, sum: wish.priceMax == null ? wish.price : null, note: wish.note },
              wishId: wish.id,
            })
          }
        >
          {t.wishDone.yes}
        </button>
      </div>
    </Modal>
  );
}

function CopyDialog({ text }: { text: string }) {
  const t = useT();
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.select();
  }, []);
  return (
    <Modal title={t.copy.title} onClose={() => closeDialog()}>
      <textarea ref={area} className="copy-area" rows={10} readOnly value={text} />
      <div className="form-actions">
        <span className="spacer" />
        <button type="button" className="btn btn-ink" onClick={() => closeDialog()}>
          {t.common.done}
        </button>
      </div>
    </Modal>
  );
}

function AccountDialog() {
  const t = useT();
  const user = useStore((s) => s.user);
  const theme = useStore((s) => s.theme);
  const prefs = useStore((s) => s.prefs);
  const googleLogin = useStore((s) => s.config.googleLogin);
  const [name, setName] = useState(user?.name ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [deleteError, setDeleteError] = useState("");

  if (!user) return null;

  const saveName = async () => {
    try {
      await postJson("/api/auth/profile", { name });
      setUser({ ...user, name: name.trim() });
      toast(t.common.saved);
    } catch (err) {
      toast(errorText(err));
    }
  };

  const changePassword = async () => {
    if (next.length < 8) return setPasswordMsg({ text: t.account.pwShort, bad: true });
    try {
      await postJson("/api/auth/password", { current: current || undefined, next });
      setUser({ ...user, hasPassword: true });
      setCurrent("");
      setNext("");
      setPasswordMsg({ text: t.account.pwUpdated, bad: false });
    } catch (err) {
      setPasswordMsg({ text: errorText(err), bad: true });
    }
  };

  const deleteAccount = async () => {
    try {
      await postJson("/api/auth/delete-account", user.hasPassword ? { password: confirm } : { confirm });
      resetToAnon();
      toast(t.account.deleted);
    } catch (err) {
      setDeleteError(errorText(err));
    }
  };

  const themes: Theme[] = ["auto", "light", "dark"];
  const sample = todayISO();

  return (
    <Modal title={t.account.title} onClose={() => closeDialog()}>
      <div className="account">
        <label className="field">
          <span className="field-label">{t.account.name}</span>
          <span className="input-with-action">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.personNameLength} />
            <button
              type="button"
              className="input-action"
              disabled={name.trim() === user.name}
              onClick={() => void saveName()}
            >
              {t.common.save}
            </button>
          </span>
        </label>
        <div className="field">
          <span className="field-label">{t.account.email}</span>
          <span>{user.email}</span>
        </div>

        <div className="field">
          <span className="field-label">{t.account.theme}</span>
          <div className="segmented" role="group" aria-label={t.account.theme}>
            {themes.map((value) => (
              <button
                key={value}
                type="button"
                className={theme === value ? "is-on" : ""}
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                {t.account.themes[value]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">{t.account.units}</span>
          <div className="segmented" role="group" aria-label={t.account.units}>
            {UNITS.map((value) => (
              <button
                key={value}
                type="button"
                className={prefs.unit === value ? "is-on" : ""}
                aria-pressed={prefs.unit === value}
                onClick={() => setPrefs({ unit: value })}
              >
                {t.account.unitNames[value]}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={prefs.dual} onChange={(e) => setPrefs({ dual: e.target.checked })} />
            <span>{t.account.dual[prefs.unit]}</span>
          </label>
          <span className="field-hint">{t.account.unitsHint}</span>
        </div>

        <div className="field">
          <span className="field-label">{t.account.dateFormat}</span>
          <div className="segmented" role="group" aria-label={t.account.dateFormat}>
            {DATE_FORMATS.map((value) => (
              <button
                key={value}
                type="button"
                className={`num${prefs.dateFormat === value ? " is-on" : ""}`}
                aria-pressed={prefs.dateFormat === value}
                onClick={() => setPrefs({ dateFormat: value })}
              >
                {formatDate(sample, value)}
              </button>
            ))}
          </div>
        </div>

        <details className="account-section">
          <summary>{user.hasPassword ? t.account.changePassword : t.account.setPassword}</summary>
          {user.hasPassword && (
            <label className="field">
              <span className="field-label">{t.account.currentPassword}</span>
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
          )}
          <label className="field">
            <span className="field-label">{t.account.newPassword}</span>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <span className="field-hint">{t.account.min8}</span>
          </label>
          <button type="button" className="btn btn-quiet" onClick={() => void changePassword()}>
            {t.account.savePassword}
          </button>
          {passwordMsg && (
            <p className={passwordMsg.bad ? "form-error" : "form-ok"} role={passwordMsg.bad ? "alert" : "status"}>
              {passwordMsg.text}
            </p>
          )}
        </details>

        {googleLogin && (
          <div className="field">
            <span className="field-label">{t.account.googleLogin}</span>
            {user.hasGoogle ? (
              <span>{t.account.linked}</span>
            ) : (
              <a className="link-btn" href={googleHref("/api/google/login")}>
                {t.account.link}
              </a>
            )}
          </div>
        )}

        <div className="btn-row">
          <button type="button" className="btn btn-ink" onClick={() => void logout()}>
            {t.account.logout}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => void logout(true)}>
            {t.account.logoutAll}
          </button>
        </div>

        <details className="account-section" open={deleting} onToggle={(e) => setDeleting(e.currentTarget.open)}>
          <summary>{t.account.deleteAccount}</summary>
          <p className="muted">{t.account.deleteText}</p>
          <label className="field">
            <span className="field-label">{user.hasPassword ? t.account.confirmPassword : t.account.confirmEmail}</span>
            <input
              type={user.hasPassword ? "password" : "text"}
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <button type="button" className="btn btn-danger" disabled={!confirm} onClick={() => void deleteAccount()}>
            {t.account.deleteAccount}
          </button>
          {deleteError && (
            <p className="form-error" role="alert">
              {deleteError}
            </p>
          )}
        </details>
      </div>
    </Modal>
  );
}

function Lightbox({ photos, index }: { photos: Photo[]; index: number }) {
  const t = useT();
  const connected = useStore((s) => s.drive.connected);
  const [i, setI] = useState(index);
  const [asking, setAsking] = useState(false);
  const [list, setList] = useState(photos);
  const touchStart = useRef<number | null>(null);
  const photo = list[i];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog();
      if (e.key === "ArrowRight") setI((v) => Math.min(v + 1, list.length - 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(v - 1, 0));
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("is-modal");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("is-modal");
    };
  }, [list.length]);

  useEffect(() => setAsking(false), [i]);

  if (!photo) return null;

  const remove = async () => {
    try {
      await del(`/api/photos/${encodeURIComponent(photo.id)}`);
      removePhoto(photo.id);
      const next = list.filter((p) => p.id !== photo.id);
      toast(t.lightbox.deleted);
      if (!next.length) return closeDialog();
      setList(next);
      setI(Math.min(i, next.length - 1));
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t.lightbox.photoOf(i + 1, list.length)}
      onTouchStart={(e) => {
        touchStart.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStart.current == null) return;
        const dx = e.changedTouches[0].clientX - touchStart.current;
        touchStart.current = null;
        if (dx < -50) setI((v) => Math.min(v + 1, list.length - 1));
        if (dx > 50) setI((v) => Math.max(v - 1, 0));
      }}
    >
      <div className="lightbox-bar">
        <span className="num">
          {i + 1} / {list.length}
        </span>
        <span className="spacer" />
        {connected && photo.driveId && (
          <a className="btn btn-small btn-on-dark" href={driveFileUrl(photo)} target="_blank" rel="noreferrer">
            {t.lightbox.onDrive}
          </a>
        )}
        {asking ? (
          <button type="button" className="btn btn-small btn-danger" onClick={() => void remove()}>
            {t.common.yesDelete}
          </button>
        ) : (
          <button type="button" className="btn btn-small btn-on-dark" onClick={() => setAsking(true)}>
            {t.common.delete}
          </button>
        )}
        <button type="button" className="icon-btn icon-on-dark" onClick={() => closeDialog()} aria-label={t.common.close}>
          <CloseIcon />
        </button>
      </div>
      <div className="lightbox-stage">
        {i > 0 && (
          <button type="button" className="lightbox-nav lightbox-prev" onClick={() => setI(i - 1)} aria-label={t.lightbox.prev}>
            <ChevronIcon left />
          </button>
        )}
        <img key={photo.id} src={photoUrl(photo, "full")} alt={photo.name} />
        {i < list.length - 1 && (
          <button type="button" className="lightbox-nav lightbox-next" onClick={() => setI(i + 1)} aria-label={t.lightbox.next}>
            <ChevronIcon />
          </button>
        )}
      </div>
    </div>
  );
}

const Toast = () => {
  const toastState = useStore((s) => s.toast);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toastState && (
        <div key={toastState.id} className="toast">
          {toastState.text}
        </div>
      )}
    </div>
  );
};

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  return (
    <>
      {dialog?.type === "fuel" && <FuelForm record={dialog.record} car={dialog.car} />}
      {dialog?.type === "service" && (
        <ServiceForm
          key={dialog.wishId ?? dialog.record?.id ?? "new"}
          record={dialog.record}
          car={dialog.car}
          draft={dialog.draft}
          wishId={dialog.wishId}
        />
      )}
      {dialog?.type === "car" && <CarForm />}
      {dialog?.type === "reminder" && <ReminderForm key={dialog.reminder?.id ?? "new"} reminder={dialog.reminder} />}
      {dialog?.type === "wish" && <WishForm key={dialog.wish?.id ?? "new"} wish={dialog.wish} />}
      {dialog?.type === "wishDone" && <WishDoneDialog wish={dialog.wish} />}
      {dialog?.type === "notify" && <NotifyDialog rows={dialog.rows} />}
      {dialog?.type === "copy" && <CopyDialog text={dialog.text} />}
      {dialog?.type === "account" && <AccountDialog />}
      {dialog?.type === "lightbox" && <Lightbox photos={dialog.photos} index={dialog.index} />}
      {dialog?.type === "manual" && <ManualForm key={dialog.manual?.id ?? "new"} manual={dialog.manual} car={dialog.car} />}
      {dialog?.type === "manualShare" && <ManualShareDialog car={dialog.car} />}
      {dialog?.type === "sharedManuals" && <SharedManualsDialog token={dialog.token} />}
      <Toast />
    </>
  );
}
