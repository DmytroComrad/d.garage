import { Hono } from "hono";
import type { AppConfig, StateResponse } from "../shared/types";
import { auth, publicUser } from "./auth";
import { data, loadGarage } from "./data";
import { backfillBudget, backfillRates, nbuToday, ratesFor } from "./fx";
import { driveStatus, googleConfigured } from "./google/connection";
import { google } from "./google/oauth";
import { collectGarbage, migrateBatch } from "./media";
import { manuals } from "./manuals";
import { photos } from "./photos";
import { sheets } from "./google/sheets";
import { clientIp, limitApi } from "./guard";
import { errorText, langOf, requestLang } from "./messages";
import { cleanupExpired, requireUser } from "./session";
import { contactShare, sharePage } from "./share";
import { ApiError, type AppEnv, type Bindings } from "./types";

const app = new Hono<AppEnv>().basePath("/api");

/** Версія форми відповіді /api/state. Підвищуй, коли в даних з'являються нові поля. */
const STATE_FORMAT = 3;

app.use("*", async (c, next) => {
  // Захист від CSRF: зміни приймаємо лише зі свого ж походження. Cookie до того ж SameSite=Lax.
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && c.req.header("origin") !== new URL(c.req.url).origin) {
    return c.json({ error: errorText(requestLang(c), "rejected") }, 403);
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
  // Дані не змінились, тож не читаємо всі рядки користувача заново. rev оновлюють тригери бази,
  // а STATE_FORMAT — коли змінюється сама форма даних (як-от поле storage у фото), щоб кеш клієнтів оновився.
  // День у версії, бо з ним приходить курс на сьогодні.
  const today = nbuToday();
  const etag = `"${user.id}:${user.rev}:${STATE_FORMAT}:${today}"`;
  // Cloudflare при стисканні робить ETag слабким: браузер повертає його з префіксом W/.
  if (c.req.header("if-none-match")?.replace(/^W\//, "") === etag) {
    c.header("ETag", etag);
    return c.body(null, 304);
  }

  const [garage, drive] = await Promise.all([
    loadGarage(c.env.DB, user.id, user.demo),
    driveStatus(c.env.DB, user.id),
  ]);
  // Без курсів сайт теж працює: суми без курсу показуються як є.
  const { rates, complete } = await ratesFor(c.env, garage, today).catch((err: unknown) => {
    console.warn(JSON.stringify({ event: "fx_failed", message: String(err) }));
    return { rates: {}, complete: false };
  });
  // Неповні курси — інша версія: наступний запит не отримає 304 і забере те, що встигли дотягнути.
  c.header("ETag", complete ? etag : `"${user.id}:${user.rev}:${STATE_FORMAT}:${today}:partial"`);
  return c.json({ user: publicUser(user), data: garage, drive, rates } satisfies StateResponse);
});

app.route("/auth", auth);
app.route("/", data);
app.route("/contacts", contactShare);
app.route("/google/sheet", sheets);
app.route("/google", google);
app.route("/photos", photos);
app.route("/manuals", manuals);

app.notFound((c) => c.json({ error: errorText(requestLang(c), "notFound") }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: errorText(requestLang(c), err.key), code: err.code }, err.status);
  // У журнал лише тип і шлях: пошта, токени й дані користувачів сюди не потрапляють.
  console.error(JSON.stringify({ event: "unhandled", name: err.name, message: err.message, path: new URL(c.req.url).pathname }));
  return c.json({ error: errorText(requestLang(c), "internal") }, 500);
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
  return Response.json({ error: errorText(langOf(request.headers.get("x-lang")), "insecure") }, { status: 403 });
}

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const refused = refuseInsecure(request, url, env);
    if (refused) return refused;
    // Єдина сторінка без входу, яку малює сам Worker: контакт, яким поділились за посиланням.
    if (url.pathname.startsWith("/c/")) return sharePage.fetch(request, env, ctx);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    return app.fetch(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    // Курси дотягуються після фото й лише в межах того, що лишилось від 50 зовнішніх запитів на виклик.
    const media = collectGarbage(env)
      .then(() => migrateBatch(env))
      .then((t) => backfillRates(env, backfillBudget(t.moved + t.gone + t.failed)));
    ctx.waitUntil(Promise.allSettled([cleanupExpired(env.DB), media]).then(() => undefined));
  },
} satisfies ExportedHandler<Bindings>;
