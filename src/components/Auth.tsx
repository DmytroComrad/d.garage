import { useState, type FormEvent } from "react";
import type { User } from "../../shared/types";
import { HttpError, postJson } from "../lib/api";
import { afterAuth, setUser, toast, useApp } from "../lib/store";
import { Odometer } from "./Odometer";
import { Turnstile } from "./Turnstile";

type Mode = "login" | "register" | "forgot" | "sent" | "reset";

const errorText = (err: unknown): string =>
  err instanceof HttpError ? err.message : "Нет связи с сервером. Проверь интернет и попробуй ещё раз.";

export function AuthScreen() {
  const { config, resetToken } = useApp();
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);

  const siteKey = config.turnstileSiteKey;
  const needsCaptcha = Boolean(siteKey) && (mode === "register" || mode === "forgot");

  const go = (next: Mode) => {
    setMode(next);
    setError("");
    setCaptcha(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode !== "reset" && !email.trim()) return setError("Укажи почту.");
    if (mode !== "forgot" && !password) return setError("Укажи пароль.");
    if ((mode === "register" || mode === "reset") && password.length < 8) {
      return setError("Пароль — минимум 8 символов.");
    }
    if (needsCaptcha && !captcha) return setError("Подожди, пока пройдёт проверка на робота.");

    setBusy(true);
    try {
      if (mode === "login") {
        const res = await postJson<{ user: User }>("/api/auth/login", { email, password });
        setUser(res.user);
        await afterAuth();
      } else if (mode === "register") {
        const res = await postJson<{ user: User }>("/api/auth/register", { email, password, name, turnstile: captcha });
        setUser(res.user);
        await afterAuth();
      } else if (mode === "forgot") {
        await postJson("/api/auth/forgot", { email, turnstile: captcha });
        setMode("sent");
      } else if (mode === "reset") {
        await postJson("/api/auth/reset", { token: resetToken, password });
        toast("Пароль обновлён");
        await afterAuth();
      }
    } catch (err) {
      setError(errorText(err));
      setCaptcha(null);
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, string> = {
    login: "Вход",
    register: "Новый гараж",
    forgot: "Восстановление пароля",
    sent: "Проверь почту",
    reset: "Новый пароль",
  };
  const actions: Partial<Record<Mode, string>> = {
    login: "Войти",
    register: "Создать гараж",
    forgot: "Отправить ссылку",
    reset: "Сохранить пароль",
  };

  return (
    <div className="auth">
      <section className="auth-intro">
        <div className="brand brand-large" aria-label="Гараж Амедро">
          <span>Гараж</span> <span className="brand-accent">Амедро</span>
        </div>
        <Odometer value={186420} decorative />
        <p className="auth-lead">
          Записывай ремонты, покупки и заправки. Расход, вложения и цена километра посчитаются сами, а о замене
          масла напомнит сайт.
        </p>
      </section>

      <section className="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title" className="auth-title">
          {titles[mode]}
        </h1>

        {mode === "sent" ? (
          <>
            <p className="muted">
              Если такая почта зарегистрирована, на неё придёт письмо со ссылкой. Она действует час. Письма нет —
              загляни в спам.
            </p>
            <button type="button" className="btn btn-ink btn-block" onClick={() => go("login")}>
              Вернуться ко входу
            </button>
          </>
        ) : (
          <form onSubmit={(e) => void submit(e)} noValidate>
            {mode === "forgot" && (
              <p className="muted">Отправим на почту ссылку, по которой можно задать новый пароль.</p>
            )}
            {mode === "register" && (
              <label className="field">
                <span className="field-label">Как тебя зовут</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
              </label>
            )}
            {mode !== "reset" && (
              <label className="field">
                <span className="field-label">Почта</span>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>
            )}
            {mode !== "forgot" && (
              <label className="field">
                <span className="field-label">Пароль</span>
                <span className="input-with-action">
                  <input
                    type={show ? "text" : "password"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" className="input-action" onClick={() => setShow(!show)}>
                    {show ? "Скрыть" : "Показать"}
                  </button>
                </span>
                {(mode === "register" || mode === "reset") && <span className="field-hint">Минимум 8 символов</span>}
              </label>
            )}

            {needsCaptcha && siteKey && <Turnstile siteKey={siteKey} onToken={setCaptcha} />}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-ink btn-block" disabled={busy}>
              {busy ? "Подожди…" : actions[mode]}
            </button>

            {mode === "login" && config.passwordReset && (
              <button type="button" className="link-btn auth-forgot" onClick={() => go("forgot")}>
                Забыл пароль
              </button>
            )}
            {mode === "login" && !config.passwordReset && config.googleLogin && (
              <p className="field-hint">Забыл пароль? Войди через Google с этой же почтой: доступ вернётся.</p>
            )}
            {(mode === "forgot" || mode === "reset") && (
              <button type="button" className="link-btn auth-forgot" onClick={() => go("login")}>
                Вернуться ко входу
              </button>
            )}
          </form>
        )}

        {config.googleLogin && (mode === "login" || mode === "register") && (
          <>
            <div className="auth-or">или</div>
            <a className="btn btn-quiet btn-block" href="/api/google/login">
              Войти через Google
            </a>
          </>
        )}

        {mode === "login" && (
          <p className="auth-switch">
            Ещё нет гаража?{" "}
            <button type="button" className="link-btn" onClick={() => go("register")}>
              Создать
            </button>
          </p>
        )}
        {mode === "register" && (
          <p className="auth-switch">
            Уже есть гараж?{" "}
            <button type="button" className="link-btn" onClick={() => go("login")}>
              Войти
            </button>
          </p>
        )}
        <p className="auth-legal">
          <a href="/privacy.html">Как мы храним данные</a>
        </p>
      </section>
    </div>
  );
}
