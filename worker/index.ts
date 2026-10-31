import { Hono } from "hono";
import { auth, publicUser } from "./auth";
import { data, loadGarage } from "./data";
import { driveStatus, google, googleConfigured, photos } from "./google";
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
  });
});

app.get("/state", requireUser, async (c) => {
  const user = c.get("user");
  const [garage, drive] = await Promise.all([
    loadGarage(c.env.DB, user.id, user.demo),
    driveStatus(c.env.DB, user.id),
  ]);
  return c.json({ user: publicUser(user), data: garage, drive });
});

app.route("/auth", auth);
app.route("/", data);
app.route("/google", google);
app.route("/photos", photos);

app.notFound((c) => c.json({ error: "Не найдено." }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message, code: err.code }, err.status);
  // У журнал лише тип і шлях: пошта, токени й дані користувачів сюди не потрапляють.
  console.error(JSON.stringify({ event: "unhandled", name: err.name, message: err.message, path: new URL(c.req.url).pathname }));
  return c.json({ error: "Что-то пошло не так. Попробуй ещё раз." }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupExpired(env.DB));
  },
} satisfies ExportedHandler<Bindings>;
