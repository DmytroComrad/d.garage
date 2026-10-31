import { useEffect, useRef, useState } from "react";
import { LIMITS } from "../../shared/constants";
import { reminderText, type RemindersRow } from "../../shared/reminders";
import type { Photo } from "../../shared/types";
import { del, errorText, postJson } from "../lib/api";
import { driveFileUrl, photoUrl } from "../lib/photos";
import {
  closeDialog,
  logout,
  markReminderDone,
  removePhoto,
  resetToAnon,
  setTab,
  setTheme,
  setUser,
  toast,
  useStore,
  type Theme,
} from "../lib/store";
import { CarForm } from "./forms/CarForm";
import { FuelForm } from "./forms/FuelForm";
import { ReminderForm } from "./forms/ReminderForm";
import { ServiceForm } from "./forms/ServiceForm";
import { ChevronIcon, CloseIcon, LampIcon } from "./icons";
import { Modal } from "./Modal";
import { Mono } from "./Mono";

function NotifyDialog({ rows }: { rows: RemindersRow[] }) {
  const [done, setDone] = useState<string[]>([]);
  const worst = Math.max(...rows.map((r) => r.status.level));
  return (
    <Modal title={worst === 3 ? "Пора заняться машиной" : "Скоро обслуживание"} onClose={() => closeDialog()} alert>
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
              <span className="muted">Сделано</span>
            ) : (
              <button
                type="button"
                className="btn btn-small btn-quiet"
                onClick={() => {
                  markReminderDone(reminder);
                  setDone([...done, reminder.id]);
                }}
              >
                Сделано
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
          Все напоминания
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-ink" onClick={() => closeDialog()}>
          Понятно
        </button>
      </div>
    </Modal>
  );
}

function CopyDialog({ text }: { text: string }) {
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.select();
  }, []);
  return (
    <Modal title="Скопируй вручную" onClose={() => closeDialog()}>
      <textarea ref={area} className="copy-area" rows={10} readOnly value={text} />
      <div className="form-actions">
        <span className="spacer" />
        <button type="button" className="btn btn-ink" onClick={() => closeDialog()}>
          Готово
        </button>
      </div>
    </Modal>
  );
}

function AccountDialog() {
  const user = useStore((s) => s.user);
  const theme = useStore((s) => s.theme);
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
      toast("Сохранено");
    } catch (err) {
      toast(errorText(err));
    }
  };

  const changePassword = async () => {
    if (next.length < 8) return setPasswordMsg({ text: "Пароль — минимум 8 символов.", bad: true });
    try {
      await postJson("/api/auth/password", { current: current || undefined, next });
      setUser({ ...user, hasPassword: true });
      setCurrent("");
      setNext("");
      setPasswordMsg({ text: "Пароль обновлён. Другие устройства вышли из аккаунта.", bad: false });
    } catch (err) {
      setPasswordMsg({ text: errorText(err), bad: true });
    }
  };

  const deleteAccount = async () => {
    try {
      await postJson("/api/auth/delete-account", user.hasPassword ? { password: confirm } : { confirm });
      resetToAnon();
      toast("Аккаунт удалён");
    } catch (err) {
      setDeleteError(errorText(err));
    }
  };

  const themes: [Theme, string][] = [
    ["auto", "Как в системе"],
    ["light", "Светлая"],
    ["dark", "Тёмная"],
  ];

  return (
    <Modal title="Профиль" onClose={() => closeDialog()}>
      <div className="account">
        <label className="field">
          <span className="field-label">Имя</span>
          <span className="input-with-action">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.personNameLength} />
            <button
              type="button"
              className="input-action"
              disabled={name.trim() === user.name}
              onClick={() => void saveName()}
            >
              Сохранить
            </button>
          </span>
        </label>
        <div className="field">
          <span className="field-label">Почта</span>
          <span>{user.email}</span>
        </div>

        <div className="field">
          <span className="field-label">Тема</span>
          <div className="segmented" role="group" aria-label="Тема">
            {themes.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={theme === value ? "is-on" : ""}
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <details className="account-section">
          <summary>{user.hasPassword ? "Сменить пароль" : "Задать пароль"}</summary>
          {user.hasPassword && (
            <label className="field">
              <span className="field-label">Текущий пароль</span>
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
          )}
          <label className="field">
            <span className="field-label">Новый пароль</span>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <span className="field-hint">Минимум 8 символов</span>
          </label>
          <button type="button" className="btn btn-quiet" onClick={() => void changePassword()}>
            Сохранить пароль
          </button>
          {passwordMsg && (
            <p className={passwordMsg.bad ? "form-error" : "form-ok"} role={passwordMsg.bad ? "alert" : "status"}>
              {passwordMsg.text}
            </p>
          )}
        </details>

        {googleLogin && (
          <div className="field">
            <span className="field-label">Вход через Google</span>
            {user.hasGoogle ? (
              <span>Привязан</span>
            ) : (
              <a className="link-btn" href="/api/google/login">
                Привязать аккаунт Google
              </a>
            )}
          </div>
        )}

        <div className="btn-row">
          <button type="button" className="btn btn-ink" onClick={() => void logout()}>
            Выйти
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => void logout(true)}>
            Выйти на всех устройствах
          </button>
        </div>

        <details className="account-section" open={deleting} onToggle={(e) => setDeleting(e.currentTarget.open)}>
          <summary>Удалить аккаунт</summary>
          <p className="muted">
            Все машины и записи удалятся без возможности восстановить. Файлы на Google Диске останутся у тебя.
          </p>
          <label className="field">
            <span className="field-label">
              {user.hasPassword ? "Пароль для подтверждения" : "Напиши свою почту для подтверждения"}
            </span>
            <input
              type={user.hasPassword ? "password" : "text"}
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <button type="button" className="btn btn-danger" disabled={!confirm} onClick={() => void deleteAccount()}>
            Удалить аккаунт
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
      toast("Фото удалено");
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
      aria-label={`Фото ${i + 1} из ${list.length}`}
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
        {connected && (
          <a className="btn btn-small btn-on-dark" href={driveFileUrl(photo)} target="_blank" rel="noreferrer">
            На Диске
          </a>
        )}
        {asking ? (
          <button type="button" className="btn btn-small btn-danger" onClick={() => void remove()}>
            Да, удалить
          </button>
        ) : (
          <button type="button" className="btn btn-small btn-on-dark" onClick={() => setAsking(true)}>
            Удалить
          </button>
        )}
        <button type="button" className="icon-btn icon-on-dark" onClick={() => closeDialog()} aria-label="Закрыть">
          <CloseIcon />
        </button>
      </div>
      <div className="lightbox-stage">
        {i > 0 && (
          <button type="button" className="lightbox-nav lightbox-prev" onClick={() => setI(i - 1)} aria-label="Предыдущее фото">
            <ChevronIcon left />
          </button>
        )}
        <img key={photo.id} src={photoUrl(photo, "full")} alt={photo.name} />
        {i < list.length - 1 && (
          <button type="button" className="lightbox-nav lightbox-next" onClick={() => setI(i + 1)} aria-label="Следующее фото">
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
      {dialog?.type === "service" && <ServiceForm record={dialog.record} car={dialog.car} />}
      {dialog?.type === "car" && <CarForm />}
      {dialog?.type === "reminder" && <ReminderForm key={dialog.reminder?.id ?? "new"} reminder={dialog.reminder} />}
      {dialog?.type === "notify" && <NotifyDialog rows={dialog.rows} />}
      {dialog?.type === "copy" && <CopyDialog text={dialog.text} />}
      {dialog?.type === "account" && <AccountDialog />}
      {dialog?.type === "lightbox" && <Lightbox photos={dialog.photos} index={dialog.index} />}
      <Toast />
    </>
  );
}
