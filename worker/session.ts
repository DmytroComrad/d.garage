import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken, sha256 } from "./crypto";
import { ApiError, type AppEnv, type SessionUser } from "./types";

const SESSION_DAYS = 60;
const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

const isHttps = (c: Context<AppEnv>) => new URL(c.req.url).protocol === "https:";
const cookieName = (c: Context<AppEnv>) => (isHttps(c) ? "__Host-session" : "session");

const setSessionCookie = (c: Context<AppEnv>, token: string) =>
  setCookie(c, cookieName(c), token, {
    path: "/",
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax",
    maxAge: SESSION_DAYS * DAY,
  });

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = randomToken();
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, now() + SESSION_DAYS * DAY, now())
    .run();
  setSessionCookie(c, token);
}

export const clearSessionCookie = (c: Context<AppEnv>) =>
  deleteCookie(c, cookieName(c), { path: "/", secure: isHttps(c) });

export async function loadUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, cookieName(c));
  if (!token) return null;
  const hash = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.password_hash, u.google_sub, u.demo, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  )
    .bind(hash)
    .first<SessionUser & { expires_at: number }>();
  if (!row || row.expires_at < now()) return null;

  // Сесія ковзна: продовжуємо не частіше разу на день, щоб не писати в базу на кожен запит.
  if (row.expires_at - now() < (SESSION_DAYS - 1) * DAY) {
    await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
      .bind(now() + SESSION_DAYS * DAY, hash)
      .run();
    setSessionCookie(c, token);
  }

  c.set("sessionHash", hash);
  const { expires_at: _expires, ...user } = row;
  return user;
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await loadUser(c);
  if (!user) throw new ApiError(401, "Нужно войти в аккаунт.", "auth");
  c.set("user", user);
  await next();
};

/** Прибрати прострочені сесії та токени скидання (щодня за cron). */
export async function cleanupExpired(db: D1Database): Promise<void> {
  const t = now();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    db.prepare("DELETE FROM password_resets WHERE expires_at < ?").bind(t),
  ]);
}
