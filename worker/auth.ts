import { Hono, type Context } from "hono";
import {
  changePasswordSchema,
  forgotSchema,
  loginSchema,
  profileSchema,
  registerSchema,
  resetSchema,
} from "../shared/schema";
import { z } from "zod";
import { burnPasswordCheck, hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { revokeGoogle } from "./google/connection";
import { clientIp, limitAuth, readJson, verifyTurnstile } from "./guard";
import { clearSessionCookie, createSession, requireUser } from "./session";
import type { AuthResponse } from "../shared/types";
import { ApiError, type AppEnv, type SessionUser } from "./types";

const now = () => Math.floor(Date.now() / 1000);
const MAX_FAILED = 10;
const LOCK_SECONDS = 15 * 60;
const RESET_TTL = 60 * 60;
const BAD_LOGIN = "Неверная почта или пароль.";

export const pepper = (c: Context<AppEnv>): string => {
  const value = c.env.PASSWORD_PEPPER;
  if (!value) throw new ApiError(503, "Сервис настраивается. Попробуй позже.");
  return value;
};

export const publicUser = (u: Pick<SessionUser, "id" | "email" | "name" | "password_hash" | "google_sub">) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  hasPassword: u.password_hash != null,
  hasGoogle: u.google_sub != null,
});

export const auth = new Hono<AppEnv>();

auth.post("/register", async (c) => {
  await limitAuth(c, `register:${clientIp(c)}`);
  const body = await readJson(c, registerSchema);
  await verifyTurnstile(c, body.turnstile);

  const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE email_key = ?").bind(body.email).first();
  if (exists) throw new ApiError(409, "Такая почта уже зарегистрирована. Войди или восстанови пароль.");

  const id = crypto.randomUUID();
  const hash = await hashPassword(body.password, pepper(c));
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, email_key, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, body.email, body.email, body.name, hash, now())
    .run();

  await createSession(c, id);
  return c.json({
    user: publicUser({ id, email: body.email, name: body.name, password_hash: hash, google_sub: null }),
  } satisfies AuthResponse);
});

auth.post("/login", async (c) => {
  const ip = clientIp(c);
  await limitAuth(c, `login:${ip}`);
  const body = await readJson(c, loginSchema);
  await limitAuth(c, `login-mail:${body.email}`);

  const user = await c.env.DB.prepare(
    "SELECT id, email, name, password_hash, google_sub, demo, failed_logins, locked_until FROM users WHERE email_key = ?",
  )
    .bind(body.email)
    .first<SessionUser & { failed_logins: number; locked_until: number }>();

  if (!user || !user.password_hash) {
    await burnPasswordCheck(body.password, pepper(c));
    throw new ApiError(401, BAD_LOGIN);
  }
  if (user.locked_until > now()) throw new ApiError(429, "Слишком много неудачных попыток. Попробуй через 15 минут.");

  const ok = await verifyPassword(body.password, user.password_hash, pepper(c));
  if (!ok) {
    const failed = user.failed_logins + 1;
    await c.env.DB.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?")
      .bind(failed >= MAX_FAILED ? 0 : failed, failed >= MAX_FAILED ? now() + LOCK_SECONDS : 0, user.id)
      .run();
    throw new ApiError(401, BAD_LOGIN);
  }

  if (user.failed_logins || user.locked_until) {
    await c.env.DB.prepare("UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?").bind(user.id).run();
  }
  await createSession(c, user.id);
  return c.json({ user: publicUser(user) } satisfies AuthResponse);
});

auth.post("/logout", requireUser, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(c.get("sessionHash")).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

auth.post("/logout-all", requireUser, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(c.get("user").id).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

auth.post("/forgot", async (c) => {
  await limitAuth(c, `forgot:${clientIp(c)}`);
  const body = await readJson(c, forgotSchema);
  await verifyTurnstile(c, body.turnstile);
  await limitAuth(c, `forgot-mail:${body.email}`);

  const user = await c.env.DB.prepare("SELECT id, email, name FROM users WHERE email_key = ?")
    .bind(body.email)
    .first<{ id: string; email: string; name: string }>();

  // Відповідь однакова незалежно від того, чи є така пошта.
  if (user && c.env.EMAIL && c.env.EMAIL_FROM) {
    const token = randomToken();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id),
      c.env.DB.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(
        await sha256(token),
        user.id,
        now() + RESET_TTL,
      ),
    ]);
    const link = `${c.env.APP_URL}/?reset=${encodeURIComponent(token)}`;
    const sending = c.env.EMAIL.send({
      to: user.email,
      from: { email: c.env.EMAIL_FROM, name: "Гараж Амедро" },
      subject: "Восстановление пароля",
      text: `Чтобы задать новый пароль, открой ссылку (действует час):\n${link}\n\nЕсли это был не ты, просто проигнорируй письмо.`,
      html: `<p>Чтобы задать новый пароль, нажми на ссылку. Она действует час.</p><p><a href="${link}">Задать новый пароль</a></p><p>Если это был не ты, просто проигнорируй письмо.</p>`,
    }).catch((err: unknown) => {
      console.error(JSON.stringify({ event: "reset_mail_failed", error: String(err) }));
    });
    c.executionCtx.waitUntil(sending);
  }
  return c.json({ ok: true });
});

auth.post("/reset", async (c) => {
  await limitAuth(c, `reset:${clientIp(c)}`);
  const body = await readJson(c, resetSchema);
  const tokenHash = await sha256(body.token);
  const row = await c.env.DB.prepare("SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?")
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: number }>();
  if (!row || row.expires_at < now()) throw new ApiError(400, "Ссылка устарела. Запроси новую.");

  const hash = await hashPassword(body.password, pepper(c));
  await revokeGoogle(c.env, row.user_id).catch(() => undefined);
  // Скидання — це доказ, що пошта своя. Усе, що прив'язали до акаунта раніше, міг зробити хтось інший,
  // хто заздалегідь зареєстрував цю адресу. Тому прив'язку Google і Диск прибираємо разом із сесіями.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE users SET password_hash = ?, google_sub = NULL, failed_logins = 0, locked_until = 0 WHERE id = ?",
    ).bind(hash, row.user_id),
    c.env.DB.prepare("DELETE FROM google_connections WHERE user_id = ?").bind(row.user_id),
    c.env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(row.user_id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id),
  ]);
  await createSession(c, row.user_id);
  return c.json({ ok: true });
});

auth.post("/password", requireUser, async (c) => {
  const user = c.get("user");
  await limitAuth(c, `password:${user.id}`);
  const body = await readJson(c, changePasswordSchema);
  if (user.password_hash) {
    const ok = body.current ? await verifyPassword(body.current, user.password_hash, pepper(c)) : false;
    if (!ok) throw new ApiError(400, "Текущий пароль неверный.");
  }
  const hash = await hashPassword(body.next, pepper(c));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(hash, user.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").bind(user.id, c.get("sessionHash")),
  ]);
  return c.json({ ok: true });
});

auth.post("/profile", requireUser, async (c) => {
  const body = await readJson(c, profileSchema);
  await c.env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(body.name, c.get("user").id).run();
  return c.json({ ok: true });
});

auth.post("/delete-account", requireUser, async (c) => {
  const user = c.get("user");
  await limitAuth(c, `delete:${user.id}`);
  const body = await readJson(c, z.object({ password: z.string().max(200).optional(), confirm: z.string().max(200).optional() }));
  if (user.password_hash) {
    const ok = body.password ? await verifyPassword(body.password, user.password_hash, pepper(c)) : false;
    if (!ok) throw new ApiError(400, "Пароль неверный.");
  } else if (body.confirm !== user.email) {
    throw new ApiError(400, "Введи свою почту для подтверждения.");
  }
  await revokeGoogle(c.env, user.id).catch(() => undefined);
  // Каскад прибирає всі машини, записи, сесії та токени Google.
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});
