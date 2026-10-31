import { Hono } from "hono";
import type { AppConfig, StateResponse } from "../shared/types";
import { auth, publicUser } from "./auth";
import { data, loadGarage } from "./data";
import { driveStatus, googleConfigured } from "./google/connection";
import { google } from "./google/oauth";
import { photos } from "./google/photos";
import { sheets } from "./google/sheets";
import { clientIp, limitApi } from "./guard";
import { cleanupExpired, requireUser } from "./session";
import { ApiError, type AppEnv, type Bindings } from "./types";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", async (c, next) => {
  // Захист від CSRF: зміни приймаємо лише зі свого ж походження. Cookie до того ж SameSite=Lax.
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && c.req.header("origin") !== new URL(c.req.url).origin) {
    return c.json({ error: "Запрос отклонён." }, 403);
  }
  await limitApi(c, `ip:${clientIp(c)}`);
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

app.get("/config", (c) => {
  const googleOn = googleConfigured(c.env);
  return c.json({
    googleLogin: googleOn,
    drive: googleOn,
    passwordReset: Boolean(c.env.EMAIL && c.env.EMAIL_FROM),
    turnstileSiteKey: c.env.TURNSTILE_SECRET ? (c.env.TURNSTILE_SITE_KEY ?? null) : null,
  } satisfies AppConfig);
});

app.get("/state", requireUser, async (c) => {
  const user = c.get("user");
  // Дані не змінились, тож не читаємо всі рядки користувача заново. rev оновлюють тригери бази.
  const etag = `"${user.id}:${user.rev}"`;
  c.header("ETag", etag);
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);

  const [garage, drive] = await Promise.all([
    loadGarage(c.env.DB, user.id, user.demo),
    driveStatus(c.env.DB, user.id),
  ]);
  return c.json({ user: publicUser(user), data: garage, drive } satisfies StateResponse);
});

app.route("/auth", auth);
app.route("/", data);
app.route("/google/sheet", sheets);
app.route("/google", google);
app.route("/photos", photos);

app.notFound((c) => c.json({ error: "Не найдено." }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message, code: err.code }, err.status);
  // У журнал лише тип і шлях: пошта, токени й дані користувачів сюди не потрапляють.
  console.error(JSON.stringify({ event: "unhandled", name: err.name, message: err.message, path: new URL(c.req.url).pathname }));
  return c.json({ error: "Что-то пошло не так. Попробуй ещё раз." }, 500);
});

/**
 * Сайт працює лише по HTTPS. Інакше посилання http:// у чужому Wi-Fi віддало б пароль і сесію відкритим текстом.
 * Перехід робимо для сторінок, а запити зі змінами відхиляємо: пароль уже пішов би мережею ще до переходу.
 */
function refuseInsecure(request: Request, url: URL, env: Bindings): Response | null {
  const site = new URL(env.APP_URL);
  if (url.protocol !== "http:" || site.protocol !== "https:" || url.hostname !== site.hostname) return null;
  if (request.method === "GET" || request.method === "HEAD") {
    return Response.redirect(`https://${url.host}${url.pathname}${url.search}`, 301);
  }
  return Response.json({ error: "Нужно защищённое соединение." }, { status: 403 });
}

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const refused = refuseInsecure(request, url, env);
    if (refused) return refused;
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    return app.fetch(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupExpired(env.DB));
  },
} satisfies ExportedHandler<Bindings>;
