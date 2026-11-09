import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../../shared/constants";
import type { ContactShareResponse, StateResponse } from "../../shared/types";
import worker from "../../worker/index";

const APP = "http://localhost";
const db = (env as unknown as { DB: D1Database }).DB;

type Init = { method?: string; body?: unknown; headers?: Record<string, string>; origin?: string };

/** Запит до Worker. Без cookie — як людина, якій просто надіслали посилання. */
const send = async (path: string, init: Init & { cookie?: string } = {}, extraEnv: Record<string, unknown> = {}) => {
  const headers: Record<string, string> = { ...init.headers };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.method && init.method !== "GET") headers.origin = init.origin ?? APP;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const ctx = createExecutionContext();
  const res = await (worker.fetch as (r: Request, e: unknown, c: ExecutionContext) => Promise<Response>)(
    new Request(`${APP}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      redirect: "manual",
    }),
    { ...(env as unknown as Record<string, unknown>), ...extraEnv },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
};

const register = async () => {
  const email = `contact-${crypto.randomUUID().slice(0, 10)}@example.com`;
  const res = await send("/api/auth/register", { method: "POST", body: { email, password: "correct horse battery" } });
  expect(res.status).toBe(200);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  const { user } = await res.json<{ user: { id: string } }>();
  const call = (path: string, init: Init = {}) => send(path, { ...init, cookie });
  const ops = (list: unknown[]) => call("/api/ops", { method: "POST", body: { ops: list } });
  const state = async () => (await call("/api/state")).json<StateResponse>();
  const share = (id: string) => call(`/api/contacts/${id}/share`, { method: "POST", body: {} });
  const unshare = (id: string) => call(`/api/contacts/${id}/share`, { method: "DELETE" });
  return { email, id: user.id, cookie, call, ops, state, share, unshare };
};

const car = (id = "car1", name = "Пасат") => ({ type: "car.put", data: { id, name } });
const contact = (over: Record<string, unknown> = {}) => ({
  type: "contact.put",
  data: {
    id: "ct1",
    car: "car1",
    name: "Іван",
    role: "Механік",
    phone: "+380 67 123 45 67",
    email: "ivan@example.com",
    link: "https://t.me/ivan_mech",
    note: "Пн–Пт до 18:00",
    ...over,
  },
});

const pathOf = (url: string) => new URL(url).pathname;
const sha256 = async (text: string) => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

describe("контакти", () => {
  it("зберігаються, змінюються й видаляються разом з усіма даними", async () => {
    const u = await register();
    expect(await (await u.ops([car(), contact()])).json()).toEqual({ rejected: [], remapped: {} });
    expect((await u.state()).data.contacts).toEqual([{ ...contact().data, shared: false }]);

    await u.ops([contact({ role: "Електрик", note: "" })]);
    expect((await u.state()).data.contacts[0]).toMatchObject({ role: "Електрик", note: "" });

    await u.ops([{ type: "contact.del", id: "ct1" }]);
    expect((await u.state()).data.contacts).toEqual([]);
  });

  it("сервер не приймає порожнє ім'я, кривий номер, пошту чи небезпечне посилання", async () => {
    const u = await register();
    await u.ops([car()]);
    for (const bad of [
      { name: " " },
      { phone: "дзвони Івану" },
      { phone: "12" },
      { email: "не пошта" },
      { email: "a@b.c?subject=x" },
      { link: "javascript:alert(1)" },
      { link: "data:text/html,hi" },
      { name: "я".repeat(LIMITS.contactNameLength + 1) },
    ]) {
      const res = await u.ops([contact({ id: "bad", ...bad })]);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    // Порожні необов'язкові поля — нормально.
    const ok = await u.ops([contact({ id: "min", role: "", phone: "", email: "", link: "", note: "" })]);
    expect(ok.status).toBe(200);
  });

  it("машина забирає свої контакти, а зміна контакту змінює версію даних", async () => {
    const u = await register();
    await u.ops([car()]);
    const etag = (await u.call("/api/state")).headers.get("etag") ?? "";
    await u.ops([contact()]);
    const res = await send("/api/state", { cookie: u.cookie, headers: { "if-none-match": etag } });
    expect(res.status).toBe(200);

    await u.ops([{ type: "car.del", id: "car1" }]);
    expect((await u.state()).data.contacts).toEqual([]);
  });

  it("ліміт контактів на акаунт", async () => {
    const u = await register();
    await u.ops([car()]);
    await db.prepare("UPDATE users SET contacts_count = ? WHERE id = ?").bind(LIMITS.contacts + LIMITS.opsPerRequest, u.id).run();
    expect((await u.ops([contact()])).status).toBe(413);
  });

  it("чужі контакти не видно й не змінити: id той самий, але це різні записи", async () => {
    const a = await register();
    const b = await register();
    await a.ops([car(), contact()]);
    const url = (await (await a.share("ct1")).json<ContactShareResponse>()).url;

    // B не може ні вимкнути, ні перевипустити посилання A.
    expect((await b.share("ct1")).status).toBe(404);
    expect((await b.unshare("ct1")).status).toBe(404);
    expect((await send(pathOf(url))).status).toBe(200);

    // Операції B з тим самим id стосуються лише B: контакт A не змінився.
    await b.ops([car(), contact({ name: "Підміна" }), { type: "contact.del", id: "ct1" }]);
    expect((await b.state()).data.contacts).toEqual([]);
    expect((await a.state()).data.contacts[0]).toMatchObject({ name: "Іван", shared: true });
    expect(JSON.stringify((await b.state()).data)).not.toContain("Іван");
  });
});

describe("посилання на контакт", () => {
  it("власник вмикає посилання, і сторінка відкривається без входу", async () => {
    const u = await register();
    await u.ops([car(), contact()]);
    const res = await u.share("ct1");
    expect(res.status).toBe(200);
    const { url } = await res.json<ContactShareResponse>();
    const token = pathOf(url).slice(3);
    expect(url.startsWith(`${APP}/c/`)).toBe(true);
    // Не менше 128 біт: 24 символи base64url — це 144 біти.
    expect(token).toMatch(/^[A-Za-z0-9_-]{22,}$/);

    // У базі лише хеш, самого токена там немає.
    const row = await db.prepare("SELECT share_hash FROM contacts WHERE user_id = ? AND id = 'ct1'").bind(u.id).first<{ share_hash: string }>();
    expect(row?.share_hash).toBe(await sha256(token));
    expect(row?.share_hash).not.toBe(token);
    expect((await u.state()).data.contacts[0].shared).toBe(true);
    // Клієнт дізнається лише, що посилання ввімкнене: ні токена, ні хешу.
    expect(JSON.stringify(await u.state())).not.toContain(row?.share_hash);

    const page = await send(pathOf(url));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("x-robots-tag")).toContain("noindex");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("script-src");
    const html = await page.text();
    expect(html).toContain("<h1>Іван</h1>");
    expect(html).toContain("Механік");
    expect(html).toContain('href="tel:+380671234567"');
    expect(html).toContain('href="mailto:ivan@example.com"');
    expect(html).toContain('href="https://t.me/ivan_mech"');
    expect(html).toContain("Пн–Пт до 18:00");
    expect(html).not.toContain("<script");
    // Про власника — нічого.
    expect(html).not.toContain(u.email);
    expect(html).not.toContain("Пасат");
    expect(html).not.toContain(u.id);
  });

  it("контакт зберігається в телефон файлом .vcf", async () => {
    const u = await register();
    await u.ops([car(), contact()]);
    const { url } = await (await u.share("ct1")).json<ContactShareResponse>();
    const res = await send(`${pathOf(url)}/vcf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/vcard; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''%D0%86%D0%B2%D0%B0%D0%BD.vcf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const card = await res.text();
    expect(card.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(card).toContain("FN:Іван\r\n");
    expect(card).toContain("TEL;TYPE=CELL:+380 67 123 45 67\r\n");
    expect(card.endsWith("END:VCARD\r\n")).toBe(true);
  });

  it("усе, що ввела людина, екрановане: HTML зі значень не виконується", async () => {
    const u = await register();
    const evil = `<script>alert(1)</script>"><img src=x onerror=alert(1)>`;
    await u.ops([car(), contact({ name: evil, role: evil, note: `${evil}\n'x'&` })]);
    const { url } = await (await u.share("ct1")).json<ContactShareResponse>();
    const html = await (await send(pathOf(url))).text();
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&#39;x&#39;&amp;");
  });

  it("сторінка говорить мовою браузера: українська, російська, інакше англійська", async () => {
    const u = await register();
    await u.ops([car(), contact()]);
    const path = pathOf((await (await u.share("ct1")).json<ContactShareResponse>()).url);
    const page = async (lang?: string) => (await send(path, { headers: lang ? { "accept-language": lang } : {} })).text();
    expect(await page("uk-UA,uk;q=0.9,en;q=0.8")).toContain("Зберегти в телефон");
    expect(await page("ru,en;q=0.5")).toContain("Сохранить в телефон");
    expect(await page("de-DE,uk;q=0.3")).toContain("Зберегти в телефон");
    expect(await page("de-DE")).toContain("Save to phone");
    expect(await page()).toContain('<html lang="en">');
  });

  it("вимкнене посилання дає 404, а нове замінює старе", async () => {
    const u = await register();
    await u.ops([car(), contact()]);
    const first = pathOf((await (await u.share("ct1")).json<ContactShareResponse>()).url);
    const second = pathOf((await (await u.share("ct1")).json<ContactShareResponse>()).url);
    expect(second).not.toBe(first);
    expect((await send(first)).status).toBe(404);
    expect((await send(second)).status).toBe(200);

    expect((await u.unshare("ct1")).status).toBe(200);
    expect((await u.state()).data.contacts[0].shared).toBe(false);
    const gone = await send(second);
    expect(gone.status).toBe(404);
    expect(gone.headers.get("x-robots-tag")).toContain("noindex");
    expect(gone.headers.get("cache-control")).toBe("no-store");
    expect(await gone.text()).not.toContain("Іван");
    expect((await send(`${second}/vcf`)).status).toBe(404);
  });

  it("випадковий чи кривий токен — та сама 404 без подробиць", async () => {
    const random = `/c/${"A".repeat(24)}`;
    const pages = await Promise.all(
      [random, `${random}/vcf`, "/c/short", "/c/%3Cscript%3E", "/c/", `${random}/extra`].map((p) => send(p)),
    );
    for (const res of pages) expect(res.status).toBe(404);
    const texts = await Promise.all(pages.map((r) => r.text()));
    expect(new Set(texts.map((t) => t.replace(/nonce="[^"]+"/g, ""))).size).toBe(1);
  });

  it("видалення контакту, машини чи акаунта вимикає посилання", async () => {
    const u = await register();
    await u.ops([car(), car("car2", "Друга"), contact(), contact({ id: "ct2" }), contact({ id: "ct3", car: "car2" })]);
    const link = async (id: string) => pathOf((await (await u.share(id)).json<ContactShareResponse>()).url);
    const [one, two, three] = [await link("ct1"), await link("ct2"), await link("ct3")];

    await u.ops([{ type: "contact.del", id: "ct1" }]);
    expect((await send(one)).status).toBe(404);
    await u.ops([{ type: "car.del", id: "car1" }]);
    expect((await send(two)).status).toBe(404);

    expect((await send(three)).status).toBe(200);
    const del = await u.call("/api/auth/delete-account", { method: "POST", body: { password: "correct horse battery" } });
    expect(del.status).toBe(200);
    expect((await send(three)).status).toBe(404);
    expect(await db.prepare("SELECT 1 FROM contacts WHERE user_id = ?").bind(u.id).first()).toBeNull();
  });

  it("вмикати й вимикати посилання може лише власник зі свого сайту", async () => {
    const u = await register();
    await u.ops([car(), contact()]);
    expect((await send("/api/contacts/ct1/share", { method: "POST", body: {} })).status).toBe(401);
    expect((await send("/api/contacts/ct1/share", { method: "POST", body: {}, cookie: u.cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await u.share("nope")).status).toBe(404);
    expect((await u.share("bad%20id")).status).toBe(404);
    // Відхилені запити нічого не ввімкнули.
    expect((await u.state()).data.contacts[0].shared).toBe(false);
  });

  it("сторінку обмежує ліміт запитів на IP", async () => {
    const u = await register();
    await u.ops([car(), contact()]);
    const path = pathOf((await (await u.share("ct1")).json<ContactShareResponse>()).url);
    const keys: string[] = [];
    const blocked = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) };
    const res = await send(path, { headers: { "cf-connecting-ip": "203.0.113.7" } }, { RL_AUTH: blocked });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.text()).not.toContain("Іван");
    expect(keys).toEqual(["share:203.0.113.7"]);
  });
});
