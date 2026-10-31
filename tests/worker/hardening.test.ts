import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "../../shared/constants";
import { applyOp, emptyData } from "../../shared/ops";
import type { GarageData, Op, OpsResponse, StateResponse } from "../../shared/types";
import worker from "../../worker/index";
import { cleanupExpired } from "../../worker/session";

const APP = "http://localhost";
const db = (env as unknown as { DB: D1Database }).DB;

type Sent = { to: string; text: string };

/** Клієнт зі своїм оточенням: у тестах можна підставити пошту, Google чи інший APP_URL. */
const makeClient = (extraEnv: Record<string, unknown> = {}, origin = APP) => {
  const cookies = new Map<string, string>();
  const call = async (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = {
      origin,
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      ...init.headers,
    };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const ctx = createExecutionContext();
    const res = await (worker.fetch as (r: Request, e: unknown, c: ExecutionContext) => Promise<Response>)(
      new Request(`${origin}${path}`, {
        method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        redirect: "manual",
      }),
      { ...(env as unknown as Record<string, unknown>), ...extraEnv },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (pair.slice(eq + 1)) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
      else cookies.delete(pair.slice(0, eq));
    }
    return res;
  };
  return { cookies, call };
};

const PASSWORD = "correct horse battery";

const register = async (extraEnv: Record<string, unknown> = {}) => {
  const client = makeClient(extraEnv);
  const email = `h-${crypto.randomUUID().slice(0, 10)}@example.com`;
  const res = await client.call("/api/auth/register", { body: { email, password: PASSWORD } });
  expect(res.status).toBe(200);
  const { user } = await res.json<{ user: { id: string } }>();
  return { client, email, id: user.id };
};

const ops = (client: ReturnType<typeof makeClient>, list: unknown[]) => client.call("/api/ops", { body: { ops: list } });
const state = async (client: ReturnType<typeof makeClient>) =>
  (await client.call("/api/state")).json<StateResponse>();

const service = (id: string, car = "car1"): Op => ({
  type: "service.put",
  data: { id, car, date: "2026-08-17", odo: 1000, cat: "Ремонт", what: "Замена", where: "", sum: 100, note: "", items: [] },
});
const fuel = (id: string, car = "car1", odo = 2000): Op => ({
  type: "fuel.put",
  data: { id, car, date: "2026-08-21", odo, liters: 37.74, sum: 2939.95, station: "", full: true, note: "" },
});
const car = (id = "car1", name = "Машина"): Op => ({ type: "car.put", data: { id, name } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("лише HTTPS", () => {
  const prod = { APP_URL: "https://garage.test" };
  const insecure = (method: string, path: string, headers: Record<string, string> = {}) => {
    const ctx = createExecutionContext();
    return (worker.fetch as (r: Request, e: unknown, c: ExecutionContext) => Promise<Response>)(
      new Request(`http://garage.test${path}`, { method, headers, redirect: "manual" }),
      { ...(env as unknown as Record<string, unknown>), ...prod },
      ctx,
    );
  };

  it("сторінка по http переходить на https зі збереженням адреси", async () => {
    const res = await insecure("GET", "/privacy?x=1");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://garage.test/privacy?x=1");
  });

  it("запит зі змінами по http відхиляється і не доходить до логіки", async () => {
    const res = await insecure("POST", "/api/auth/login", { origin: "http://garage.test" });
    expect(res.status).toBe(403);
  });

  it("по https запит обробляється", async () => {
    const res = await makeClient(prod, "https://garage.test").call("/api/config");
    expect(res.status).toBe(200);
  });

  it("локальна розробка по http працює, навіть якщо APP_URL на https", async () => {
    expect((await makeClient(prod).call("/api/config")).status).toBe(200);
  });

  it("сторінки, а не API, віддає сховище статики", async () => {
    const fetchAsset = vi.fn(async () => new Response("<html>"));
    const res = await makeClient({ ...prod, ASSETS: { fetch: fetchAsset } }, "https://garage.test").call("/anything");
    expect(await res.text()).toBe("<html>");
    expect(fetchAsset).toHaveBeenCalledOnce();
  });
});

describe("лічильники й версія даних", () => {
  const counters = (id: string) =>
    db
      .prepare("SELECT rev, cars_count, service_count, fuel_count, reminders_count, photos_count FROM users WHERE id = ?")
      .bind(id)
      .first<Record<string, number>>();

  it("лічильники точні після додавання, зміни, видалення й каскаду", async () => {
    const { client, id } = await register();
    await ops(client, [car(), service("s1"), service("s2"), fuel("f1")]);
    expect(await counters(id)).toMatchObject({ cars_count: 1, service_count: 2, fuel_count: 1 });

    await ops(client, [service("s1")]);
    expect(await counters(id)).toMatchObject({ service_count: 2 });

    await ops(client, [{ type: "service.del", id: "s2" }]);
    expect(await counters(id)).toMatchObject({ service_count: 1 });

    await ops(client, [{ type: "car.del", id: "car1" }]);
    expect(await counters(id)).toMatchObject({ cars_count: 0, service_count: 0, fuel_count: 0 });
  });

  it("лічильники збігаються з COUNT(*) після стирання всього", async () => {
    const { client, id } = await register();
    await ops(client, [car(), service("s1"), fuel("f1")]);
    await ops(client, [{ type: "all.del" }]);
    expect(await counters(id)).toMatchObject({ cars_count: 0, service_count: 0, fuel_count: 0 });
  });

  it("незмінні дані дають 304 без тіла, будь-яка зміна — новий ETag", async () => {
    const { client } = await register();
    const first = await client.call("/api/state");
    const etag = first.headers.get("etag") ?? "";
    expect(etag).not.toBe("");

    const same = await client.call("/api/state", { headers: { "if-none-match": etag } });
    expect(same.status).toBe(304);
    expect(await same.text()).toBe("");

    await ops(client, [car()]);
    const changed = await client.call("/api/state", { headers: { "if-none-match": etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
  });

  it.each<[string, (c: ReturnType<typeof makeClient>) => Promise<unknown>]>([
    ["ім'я", (c) => c.call("/api/auth/profile", { body: { name: "Новое" } })],
    ["демо", (c) => ops(c, [{ type: "demo.set", value: true }])],
    ["машина", (c) => ops(c, [car()])],
    ["напоминание", (c) => ops(c, [car(), {
      type: "reminder.put",
      data: { id: "r", car: "car1", title: "x", dueOdo: 5, dueDate: null, done: false, doneDate: null, notified: 0, recordId: null },
    }])],
  ])("%s змінює версію", async (_label, change) => {
    const { client } = await register();
    const etag = (await client.call("/api/state")).headers.get("etag") ?? "";
    await change(client);
    expect((await client.call("/api/state", { headers: { "if-none-match": etag } })).status).toBe(200);
  });

  it("слабкий ETag від Cloudflare теж дає 304", async () => {
    const { client } = await register();
    const etag = (await client.call("/api/state")).headers.get("etag") ?? "";
    const res = await client.call("/api/state", { headers: { "if-none-match": `W/${etag}` } });
    expect(res.status).toBe(304);
  });

  it("ETag одного користувача не підходить іншому", async () => {
    const a = await register();
    const b = await register();
    const etag = (await a.client.call("/api/state")).headers.get("etag") ?? "";
    expect((await b.client.call("/api/state", { headers: { "if-none-match": etag } })).status).toBe(200);
  });
});

describe("межі на акаунт", () => {
  it("понад ліміт записів сервер відмовляє з 413", async () => {
    const { client, id } = await register();
    await db.prepare("UPDATE users SET service_count = ? WHERE id = ?").bind(LIMITS.service + LIMITS.opsPerRequest, id).run();
    await ops(client, [car()]);
    const res = await ops(client, [service("s1")]);
    expect(res.status).toBe(413);
  });

  it("зайвий розмір запиту відхиляється", async () => {
    const { client } = await register();
    const res = await client.call("/api/ops", { body: { ops: Array.from({ length: LIMITS.opsPerRequest + 1 }, () => car()) } });
    expect(res.status).toBe(400);
  });
});

describe("дублікати машин", () => {
  it("нова машина з наявною назвою зливається, її записи не губляться", async () => {
    const { client } = await register();
    await ops(client, [car("first", "Пассат")]);
    const res = await ops(client, [car("second", "ПАССАТ"), fuel("f1", "second"), service("s1", "second")]);
    expect(await res.json<OpsResponse>()).toEqual({ rejected: [], remapped: { second: "first" } });

    const { data } = await state(client);
    expect(data.cars.map((c) => c.id)).toEqual(["first"]);
    expect(data.fuel[0].car).toBe("first");
    expect(data.service[0].car).toBe("first");
  });

  it("перейменування наявної машини на зайняту назву лишається помилкою", async () => {
    const { client } = await register();
    await ops(client, [car("a", "Первая"), car("b", "Вторая")]);
    const res = await ops(client, [car("b", "Первая")]);
    expect(await res.json<OpsResponse>()).toEqual({ rejected: [0], remapped: {} });
    const { data } = await state(client);
    expect(data.cars.find((c) => c.id === "b")?.name).toBe("Вторая");
  });

  it("машину з тією ж назвою можна створити після видалення попередньої", async () => {
    const { client } = await register();
    await ops(client, [car("a", "Пассат")]);
    const res = await ops(client, [{ type: "car.del", id: "a" }, car("b", "Пассат")]);
    expect(await res.json<OpsResponse>()).toEqual({ rejected: [], remapped: {} });
    expect((await state(client)).data.cars.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("переїзд запису", () => {
  it("фото й нагадування переходять на нову машину разом із записом", async () => {
    const { client, id } = await register();
    await ops(client, [car("a", "A"), car("b", "B"), service("s1", "a")]);
    await db
      .prepare(
        `INSERT INTO photos (user_id, id, car_id, kind, record_id, drive_id, name, mime, created_at)
         VALUES (?, 'p1', 'a', 'record', 's1', 'd1', 'x', 'image/jpeg', 0)`,
      )
      .bind(id)
      .run();
    await ops(client, [{
      type: "reminder.put",
      data: { id: "r1", car: "a", title: "x", dueOdo: 5, dueDate: null, done: false, doneDate: null, notified: 0, recordId: "s1" },
    }]);

    await ops(client, [service("s1", "b")]);
    const { data } = await state(client);
    expect(data.photos[0].car).toBe("b");
    expect(data.reminders[0].car).toBe("b");
  });
});

describe("клієнт і сервер рахують однаково", () => {
  const sort = (d: GarageData) => ({
    ...d,
    cars: [...d.cars].sort((a, b) => a.id.localeCompare(b.id)),
    service: [...d.service].sort((a, b) => a.id.localeCompare(b.id)),
    fuel: [...d.fuel].sort((a, b) => a.id.localeCompare(b.id)),
    reminders: [...d.reminders].sort((a, b) => a.id.localeCompare(b.id)),
  });
  const reminder = (id: string, c: string, recordId: string | null = null): Op => ({
    type: "reminder.put",
    data: { id, car: c, title: "x", dueOdo: 5000, dueDate: null, done: false, doneDate: null, notified: 0, recordId },
  });

  it.each<[string, Op[]]>([
    ["створення", [car("a", "A"), service("s1", "a"), fuel("f1", "a"), reminder("r1", "a")]],
    ["оновлення", [car("a", "A"), service("s1", "a"), service("s1", "a"), car("a", "Новое")]],
    ["видалення записів", [car("a", "A"), service("s1", "a"), fuel("f1", "a"), { type: "service.del", id: "s1" }, { type: "fuel.del", id: "f1" }]],
    ["видалення машини", [car("a", "A"), car("b", "B"), service("s1", "a"), fuel("f2", "b"), reminder("r1", "a"), { type: "car.del", id: "a" }]],
    ["переїзд", [car("a", "A"), car("b", "B"), service("s1", "a"), reminder("r1", "a", "s1"), service("s1", "b")]],
    ["видалення нагадування", [car("a", "A"), reminder("r1", "a"), { type: "reminder.del", id: "r1" }]],
    ["демо", [{ type: "demo.set", value: true }]],
    ["стерти все", [car("a", "A"), service("s1", "a"), { type: "demo.set", value: true }, { type: "all.del" }]],
  ])("%s", async (_label, list) => {
    const { client } = await register();
    await ops(client, list);
    const server = (await state(client)).data;
    const local = list.reduce(applyOp, emptyData());
    expect(sort(server)).toEqual(sort(local));
  });
});

describe("службове: вхід і скидання пароля", () => {
  const withMail = () => {
    const sent: Sent[] = [];
    return {
      sent,
      env: {
        EMAIL_FROM: "noreply@garage.test",
        EMAIL: {
          send: async (message: { to: string; text: string }) => {
            sent.push({ to: message.to, text: message.text });
          },
        },
      },
    };
  };
  const tokenFrom = (text: string): string => decodeURIComponent(/reset=([^\s]+)/.exec(text)?.[1] ?? "");

  it("пошта вимкнена: forgot не видає, чи є такий акаунт", async () => {
    const { email } = await register();
    const known = await makeClient().call("/api/auth/forgot", { body: { email } });
    const unknown = await makeClient().call("/api/auth/forgot", { body: { email: "nobody@example.com" } });
    expect(await known.json()).toEqual(await unknown.json());
  });

  it("повний цикл: лист, новий пароль, старий не діє, старі сесії закінчились", async () => {
    const mail = withMail();
    const { client, email } = await register(mail.env);
    await makeClient(mail.env).call("/api/auth/forgot", { body: { email } });
    expect(mail.sent[0].to).toBe(email);

    const fresh = makeClient(mail.env);
    const reset = await fresh.call("/api/auth/reset", { body: { token: tokenFrom(mail.sent[0].text), password: "brand new password" } });
    expect(reset.status).toBe(200);
    expect((await fresh.call("/api/state")).status).toBe(200);

    expect((await client.call("/api/state")).status).toBe(401);
    expect((await makeClient().call("/api/auth/login", { body: { email, password: PASSWORD } })).status).toBe(401);
    expect((await makeClient().call("/api/auth/login", { body: { email, password: "brand new password" } })).status).toBe(200);
  });

  it("токен одноразовий, а чужий чи прострочений не діє", async () => {
    const mail = withMail();
    const { email, id } = await register(mail.env);
    await makeClient(mail.env).call("/api/auth/forgot", { body: { email } });
    const token = tokenFrom(mail.sent[0].text);
    expect((await makeClient().call("/api/auth/reset", { body: { token, password: "brand new password" } })).status).toBe(200);
    expect((await makeClient().call("/api/auth/reset", { body: { token, password: "another password" } })).status).toBe(400);
    expect((await makeClient().call("/api/auth/reset", { body: { token: "x".repeat(30), password: "another password" } })).status).toBe(400);

    await makeClient(mail.env).call("/api/auth/forgot", { body: { email } });
    await db.prepare("UPDATE password_resets SET expires_at = 1 WHERE user_id = ?").bind(id).run();
    expect((await makeClient().call("/api/auth/reset", { body: { token: tokenFrom(mail.sent[1].text), password: "another password" } })).status).toBe(400);
  });

  it("скидання прибирає чужу прив'язку Google і Диск", async () => {
    const mail = withMail();
    const { email, id } = await register(mail.env);
    await db.prepare("UPDATE users SET google_sub = ? WHERE id = ?").bind(`attacker-${id}`, id).run();
    await db
      .prepare("INSERT INTO google_connections (user_id, refresh_token_enc, connected_at) VALUES (?, 'not-decryptable', 0)")
      .bind(id)
      .run();

    await makeClient(mail.env).call("/api/auth/forgot", { body: { email } });
    const res = await makeClient(mail.env).call("/api/auth/reset", { body: { token: tokenFrom(mail.sent[0].text), password: "brand new password" } });
    expect(res.status).toBe(200);

    const row = await db.prepare("SELECT google_sub FROM users WHERE id = ?").bind(id).first<{ google_sub: string | null }>();
    expect(row?.google_sub).toBeNull();
    expect(await db.prepare("SELECT 1 FROM google_connections WHERE user_id = ?").bind(id).first()).toBeNull();
  });

  it("після 10 невдалих спроб вхід блокується, і правильний пароль теж не проходить", async () => {
    const { email, id } = await register();
    for (let i = 0; i < 10; i++) {
      await makeClient().call("/api/auth/login", { body: { email, password: "wrong password" } });
    }
    const locked = await makeClient().call("/api/auth/login", { body: { email, password: PASSWORD } });
    expect(locked.status).toBe(429);

    await db.prepare("UPDATE users SET locked_until = 1 WHERE id = ?").bind(id).run();
    expect((await makeClient().call("/api/auth/login", { body: { email, password: PASSWORD } })).status).toBe(200);
  });

  it("вихід на всіх пристроях закінчує всі сесії", async () => {
    const { client, email } = await register();
    const other = makeClient();
    await other.call("/api/auth/login", { body: { email, password: PASSWORD } });
    await client.call("/api/auth/logout-all", { body: {} });
    expect((await client.call("/api/state")).status).toBe(401);
    expect((await other.call("/api/state")).status).toBe(401);
  });

  it("ім'я в профілі зберігається", async () => {
    const { client } = await register();
    await client.call("/api/auth/profile", { body: { name: "Новое имя" } });
    expect((await state(client)).user.name).toBe("Новое имя");
  });

  it("прострочені сесії й токени прибирає щоденна чистка", async () => {
    const { client, id } = await register();
    await db.prepare("UPDATE sessions SET expires_at = 1 WHERE user_id = ?").bind(id).run();
    await db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, 1)").bind(`old-${id}`, id).run();
    expect((await client.call("/api/state")).status).toBe(401);

    await cleanupExpired(db);
    expect(await db.prepare("SELECT 1 FROM sessions WHERE user_id = ?").bind(id).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM password_resets WHERE user_id = ?").bind(id).first()).toBeNull();
  });
});
