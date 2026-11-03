import { useState, type FormEvent } from "react";
import { LIMITS } from "../../shared/constants";
import type { AuthResponse } from "../../shared/types";
import { errorText, postJson } from "../lib/api";
import { afterAuth, clearResetToken, googleHref, toast, useStore, useT } from "../lib/store";
import { Brand } from "./Garage";
import { LangMenu } from "./LangMenu";
import { Odometer } from "./Odometer";
import { Turnstile } from "./Turnstile";

type Mode = "login" | "register" | "forgot" | "sent" | "reset";

export function AuthScreen() {
  const t = useT();
  const config = useStore((s) => s.config);
  const resetToken = useStore((s) => s.resetToken);
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  // Токен Turnstile одноразовий. Новий ключ перестворює віджет, і він видає наступний.
  const [captchaRound, setCaptchaRound] = useState(0);

  const siteKey = config.turnstileSiteKey;
  const needsCaptcha = Boolean(siteKey) && (mode === "register" || mode === "forgot");

  const go = (next: Mode) => {
    setMode(next);
    setError("");
    setCaptcha(null);
    if (mode === "reset") clearResetToken();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode !== "reset" && !email.trim()) return setError(t.auth.errEmail);
    if (mode !== "forgot" && !password) return setError(t.auth.errPassword);
    if ((mode === "register" || mode === "reset") && password.length < 8) {
      return setError(t.auth.errShort);
    }
    if (needsCaptcha && !captcha) return setError(t.auth.errCaptcha);

    setBusy(true);
    try {
      if (mode === "login") {
        await postJson<AuthResponse>("/api/auth/login", { email, password });
        await afterAuth();
      } else if (mode === "register") {
        await postJson<AuthResponse>("/api/auth/register", { email, password, name, turnstile: captcha });
        await afterAuth();
      } else if (mode === "forgot") {
        await postJson("/api/auth/forgot", { email, turnstile: captcha });
        setMode("sent");
      } else if (mode === "reset") {
        await postJson("/api/auth/reset", { token: resetToken, password });
        await afterAuth();
        clearResetToken();
        toast(t.auth.pwUpdated);
      }
    } catch (err) {
      setError(errorText(err));
      setCaptcha(null);
      setCaptchaRound((round) => round + 1);
    } finally {
      setBusy(false);
    }
  };

  const actions: Record<Exclude<Mode, "sent">, string> = t.auth.actions;

  return (
    <div className="auth">
      <div className="auth-lang">
        <LangMenu />
      </div>
      <section className="auth-intro">
        <Brand large />
        <Odometer value={186420} decorative />
        <p className="auth-lead">{t.auth.lead}</p>
      </section>

      <section className="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title" className="auth-title">
          {t.auth.titles[mode]}
        </h1>

        {mode === "sent" ? (
          <>
            <p className="muted">{t.auth.sentText}</p>
            <button type="button" className="btn btn-ink btn-block" onClick={() => go("login")}>
              {t.auth.backToLogin}
            </button>
          </>
        ) : (
          <form onSubmit={(e) => void submit(e)} noValidate>
            {mode === "forgot" && <p className="muted">{t.auth.forgotText}</p>}
            {mode === "register" && (
              <label className="field">
                <span className="field-label">{t.auth.name}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={LIMITS.personNameLength}
                />
              </label>
            )}
            {mode !== "reset" && (
              <label className="field">
                <span className="field-label">{t.auth.email}</span>
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
                <span className="field-label">{t.auth.password}</span>
                <span className="input-with-action">
                  <input
                    type={show ? "text" : "password"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" className="input-action" onClick={() => setShow(!show)}>
                    {show ? t.auth.hide : t.auth.show}
                  </button>
                </span>
                {(mode === "register" || mode === "reset") && <span className="field-hint">{t.auth.min8}</span>}
              </label>
            )}

            {needsCaptcha && siteKey && <Turnstile key={captchaRound} siteKey={siteKey} onToken={setCaptcha} />}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-ink btn-block" disabled={busy}>
              {busy ? t.common.wait : actions[mode]}
            </button>

            {mode === "login" && config.passwordReset && (
              <button type="button" className="link-btn auth-forgot" onClick={() => go("forgot")}>
                {t.auth.forgot}
              </button>
            )}
            {mode === "login" && !config.passwordReset && config.googleLogin && (
              <p className="field-hint">{t.auth.forgotGoogle}</p>
            )}
            {(mode === "forgot" || mode === "reset") && (
              <button type="button" className="link-btn auth-forgot" onClick={() => go("login")}>
                {t.auth.backToLogin}
              </button>
            )}
          </form>
        )}

        {config.googleLogin && (mode === "login" || mode === "register") && (
          <>
            <div className="auth-or">{t.auth.or}</div>
            <a className="btn btn-quiet btn-block" href={googleHref("/api/google/login")}>
              {t.auth.google}
            </a>
          </>
        )}

        {mode === "login" && (
          <p className="auth-switch">
            {t.auth.noGarage}{" "}
            <button type="button" className="link-btn" onClick={() => go("register")}>
              {t.auth.create}
            </button>
          </p>
        )}
        {mode === "register" && (
          <p className="auth-switch">
            {t.auth.haveGarage}{" "}
            <button type="button" className="link-btn" onClick={() => go("login")}>
              {t.auth.login}
            </button>
          </p>
        )}
        <p className="auth-legal">
          <a href="/privacy">{t.auth.privacy}</a>
        </p>
      </section>
    </div>
  );
}
