import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { encryptToken, randomToken, sha256 } from "../crypto";
import { createSession, isHttps, loadUser, requireUser } from "../session";
import { ApiError, type AppEnv, type Bindings } from "../types";
import { DRIVE_SCOPE, TOKEN_URL, ensureFolders, getConnection, googleConfigured, revokeGoogle, tokenKey } from "./connection";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const now = () => Math.floor(Date.now() / 1000);

/** __Host- не дає сусідньому піддомену підставити свою cookie зі станом входу. */
const oauthCookie = (c: Context<AppEnv>): string => (isHttps(c) ? "__Host-g_oauth" : "g_oauth");
const redirectUri = (env: Bindings): string => `${env.APP_URL}/api/google/callback`;

type OAuthState = { state: string; verifier: string; mode: "login" | "drive"; uid: string | null };

type Tokens = {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

const beginOAuth = async (
  c: Context<AppEnv>,
  mode: OAuthState["mode"],
  uid: string | null,
  scope: string,
  extra: Record<string, string>,
) => {
  if (!googleConfigured(c.env)) throw new ApiError(503, "Google пока не настроен на сервере.");
  const state = randomToken(24);
  const verifier = randomToken(48);
  const payload: OAuthState = { state, verifier, mode, uid };
  setCookie(c, oauthCookie(c), btoa(JSON.stringify(payload)), {
    path: "/",
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax",
    maxAge: 600,
  });
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(c.env),
    response_type: "code",
    scope,
    state,
    // PKCE S256 — це і є SHA-256 у base64url.
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
    ...extra,
  }).toString();
  return c.redirect(url.toString(), 302);
};

const decodeIdToken = (idToken: string): Record<string, unknown> => {
  // Токен отримано напряму від Google по TLS, тому окрема перевірка підпису не потрібна (OIDC Core 3.1.3.7).
  const part = idToken.split(".")[1] ?? "";
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(json, (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
};

const isVerified = (claims: Record<string, unknown>): boolean =>
  claims.email_verified === true || claims.email_verified === "true";

async function finishLogin(c: Context<AppEnv>, claims: Record<string, unknown>): Promise<Response> {
  const sub = String(claims.sub ?? "");
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const name = typeof claims.name === "string" ? claims.name.slice(0, 80) : "";
  if (!sub || !email || !isVerified(claims)) return c.redirect("/?google=unverified");

  const db = c.env.DB;

  // Користувач уже в акаунті: прив'язуємо Google до нього.
  const current = await loadUser(c);
  if (current) {
    const taken = await db.prepare("SELECT id FROM users WHERE google_sub = ? AND id <> ?").bind(sub, current.id).first();
    if (taken) return c.redirect("/?google=taken");
    await db.prepare("UPDATE users SET google_sub = ? WHERE id = ?").bind(sub, current.id).run();
    return c.redirect("/?google=linked");
  }

  const bySub = await db.prepare("SELECT id FROM users WHERE google_sub = ?").bind(sub).first<{ id: string }>();
  if (bySub) {
    await createSession(c, bySub.id);
    return c.redirect("/");
  }

  const byEmail = await db
    .prepare("SELECT u.id, g.google_email FROM users u LEFT JOIN google_connections g ON g.user_id = u.id WHERE u.email_key = ?")
    .bind(email)
    .first<{ id: string; google_email: string | null }>();
  if (byEmail) {
    /*
     * Пошту при реєстрації за паролем ми не підтверджуємо. Хтось міг заздалегідь зареєструвати
     * чужу адресу, тому справжній власник (Google це підтвердив) забирає акаунт: старий пароль
     * і всі сесії скасовуються. Диск лишається лише тоді, коли точно належить цій самій адресі:
     * інакше нові фото й таблиця власника пішли б на чужий Диск.
     */
    const statements = [
      db.prepare("UPDATE users SET google_sub = ?, password_hash = NULL WHERE id = ?").bind(sub, byEmail.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(byEmail.id),
    ];
    if (byEmail.google_email?.toLowerCase() !== email) {
      statements.push(db.prepare("DELETE FROM google_connections WHERE user_id = ?").bind(byEmail.id));
    }
    await db.batch(statements);
    await createSession(c, byEmail.id);
    return c.redirect("/?google=claimed");
  }

  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, email_key, name, google_sub, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, email, email, name, sub, now())
    .run();
  await createSession(c, id);
  return c.redirect("/");
}

async function finishDrive(c: Context<AppEnv>, uid: string | null, tokens: Tokens): Promise<Response> {
  const user = await loadUser(c);
  if (!user || user.id !== uid) return c.redirect("/?drive=error");
  if (!tokens.scope?.split(" ").includes(DRIVE_SCOPE) || !tokens.access_token) return c.redirect("/?drive=scope");

  // Параметри доступу проходять через браузер, тому їх можна підмінити. Без підтвердженої пошти
  // не зрозуміти, чий це Диск, а від цього залежить, чи лишиться він при поверненні акаунта власнику.
  const claims = tokens.id_token ? decodeIdToken(tokens.id_token) : {};
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email || !isVerified(claims)) return c.redirect("/?drive=scope");

  const key = tokenKey(c.env);
  const previous = await getConnection(c.env.DB, user.id);
  const refresh = tokens.refresh_token
    ? await encryptToken(tokens.refresh_token, key, user.id)
    : previous?.refresh_token_enc;
  if (!refresh) return c.redirect("/?drive=error");

  await c.env.DB.prepare(
    `INSERT INTO google_connections (user_id, google_email, refresh_token_enc, access_token_enc, access_expires, connected_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (user_id) DO UPDATE SET google_email = ?2, refresh_token_enc = ?3, access_token_enc = ?4, access_expires = ?5`,
  )
    .bind(
      user.id,
      email,
      refresh,
      await encryptToken(tokens.access_token, key, user.id),
      now() + (tokens.expires_in ?? 3600),
      now(),
    )
    .run();

  const conn = await getConnection(c.env.DB, user.id);
  if (conn) await ensureFolders(c.env, conn, tokens.access_token);
  return c.redirect("/?drive=connected");
}

export const google = new Hono<AppEnv>();

google.get("/login", (c) => beginOAuth(c, "login", null, "openid email profile", { prompt: "select_account" }));

google.get("/drive/connect", requireUser, (c) =>
  beginOAuth(c, "drive", c.get("user").id, `openid email ${DRIVE_SCOPE}`, {
    access_type: "offline",
    prompt: "consent",
    login_hint: c.get("user").email,
  }),
);

google.get("/callback", async (c) => {
  const raw = getCookie(c, oauthCookie(c));
  deleteCookie(c, oauthCookie(c), { path: "/", secure: isHttps(c) });
  let saved: OAuthState | null = null;
  try {
    saved = raw ? (JSON.parse(atob(raw)) as OAuthState) : null;
  } catch {
    saved = null;
  }
  const state = c.req.query("state");
  if (!saved || !state || state !== saved.state) return c.redirect("/?google=state");

  const code = c.req.query("code");
  if (c.req.query("error") || !code) {
    return c.redirect(saved.mode === "drive" ? "/?drive=denied" : "/?google=denied");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: c.env.GOOGLE_CLIENT_SECRET ?? "",
      code,
      code_verifier: saved.verifier,
      redirect_uri: redirectUri(c.env),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return c.redirect(saved.mode === "drive" ? "/?drive=error" : "/?google=error");
  const tokens = await res.json<Tokens>();

  if (saved.mode === "drive") return finishDrive(c, saved.uid, tokens);
  if (!tokens.id_token) return c.redirect("/?google=error");
  return finishLogin(c, decodeIdToken(tokens.id_token));
});

google.post("/drive/disconnect", requireUser, async (c) => {
  const user = c.get("user");
  await revokeGoogle(c.env, user.id).catch(() => undefined);
  await c.env.DB.prepare("DELETE FROM google_connections WHERE user_id = ?").bind(user.id).run();
  return c.json({ ok: true });
});
