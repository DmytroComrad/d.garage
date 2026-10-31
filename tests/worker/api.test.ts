import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGIN = "http://localhost";

type Client = {
  cookie: string;
  call: (path: string, init?: { method?: string; body?: unknown; origin?: string | null }) => Promise<Response>;
};

const fetchWorker = (path: string, init: RequestInit) =>
  (exports as unknown as { default: { fetch: (url: string, init: RequestInit) => Promise<Response> } }).default.fetch(
    `${ORIGIN}${path}`,
    init,
  );

const newClient = (): Client => {
  const client: Client = {
    cookie: "",
    call: async (path, { method, body, origin } = {}) => {
      const headers: Record<string, string> = {};
      if (client.cookie) headers.cookie = client.cookie;
      if (origin !== null) headers.origin = origin ?? ORIGIN;
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await fetchWorker(path, {
        method: method ?? (body !== undefined ? "POST" : "GET"),
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "manual",
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        const pair = setCookie.split(";")[0];
        client.cookie = pair.endsWith("=") ? "" : pair;
      }
      return res;
    },
  };
  return client;
};

let seq = 0;
const register = async (password = "correct horse battery") => {
  const client = newClient();
  const email = `user${++seq}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const res = await client.call("/api/auth/register", { body: { email, password, name: "Тест" } });
  expect(res.status).toBe(200);
  return { client, email, password };
};

const car = (id = "car1", name = "Машина") => ({ type: "car.put", data: { id, name } });
const service = (id: string, carId = "car1") => ({
  type: "service.put",
  data: {
    id,
    car: carId,
    date: "2026-08-17",
    odo: 1000,
    cat: "Ремонт",
    what: "Замена",
    where: "",
    sum: 9000,
    note: "",
    items: [
      { id: "a", kind: "parts", name: "Запчасти", sum: 5000 },
      { id: "b", kind: "labor", name: "Работа", sum: 4000 },
    ],
  },
});
const fuelOp = (id: string, carId = "car1", odo = 2000) => ({
  type: "fuel.put",
  data: { id, car: carId, date: "2026-08-21", odo, liters: 37.74, sum: 2939.95, station: "", full: true, note: "" },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("вхід", () => {
  it("реєстрація створює сесію з безпечною cookie", async () => {
    const client = newClient();
    const res = await client.call("/api/auth/register", {
      body: { email: `new-${crypto.randomUUID()}@example.com`, password: "long enough pass" },
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const state = await client.call("/api/state");
    expect(state.status).toBe(200);
  });

  it("без сесії дані недоступні", async () => {
    const res = await newClient().call("/api/state");
    expect(res.status).toBe(401);
  });

  it("вхід і вихід", async () => {
    const { client, email, password } = await register();
    await client.call("/api/auth/logout", { body: {} });
    expect((await client.call("/api/state")).status).toBe(401);

    const again = newClient();
    expect((await again.call("/api/auth/login", { body: { email, password: "wrong password" } })).status).toBe(401);
    expect((await again.call("/api/auth/login", { body: { email, password } })).status).toBe(200);
    expect((await again.call("/api/state")).status).toBe(200);
  });

  it("пошта без урахування регістру, дубль не проходить", async () => {
    const { email, password } = await register();
    const dup = await newClient().call("/api/auth/register", { body: { email: email.toUpperCase(), password } });
    expect(dup.status).toBe(409);
    const login = await newClient().call("/api/auth/login", { body: { email: email.toUpperCase(), password } });
    expect(login.status).toBe(200);
  });

  it("короткий пароль не приймається", async () => {
    const res = await newClient().call("/api/auth/register", {
      body: { email: `s-${crypto.randomUUID()}@example.com`, password: "short" },
    });
    expect(res.status).toBe(400);
  });

  it("помилка однакова для невідомої пошти й неправильного пароля", async () => {
    const { email } = await register();
    const wrong = await newClient().call("/api/auth/login", { body: { email, password: "wrong password" } });
    const unknown = await newClient().call("/api/auth/login", {
      body: { email: "nobody@example.com", password: "wrong password" },
    });
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("зміна пароля вимагає поточний і скидає інші сесії", async () => {
    const { client, email, password } = await register();
    const second = newClient();
    await second.call("/api/auth/login", { body: { email, password } });

    expect((await client.call("/api/auth/password", { body: { current: "nope", next: "new long password" } })).status).toBe(400);
    expect((await client.call("/api/auth/password", { body: { current: password, next: "new long password" } })).status).toBe(200);
    expect((await second.call("/api/state")).status).toBe(401);
    expect((await client.call("/api/state")).status).toBe(200);
  });

  it("запити з чужого сайту відхиляються", async () => {
    const { client } = await register();
    const res = await client.call("/api/ops", { body: { ops: [car()] }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    const none = await client.call("/api/ops", { body: { ops: [car()] }, origin: null });
    expect(none.status).toBe(403);
  });
});

describe("дані", () => {
  it("записи зберігаються, а позиції читаються назад", async () => {
    const { client } = await register();
    const res = await client.call("/api/ops", { body: { ops: [car(), service("s1"), fuelOp("f1")] } });
    expect(await res.json()).toEqual({ rejected: [] });

    const state = await (await client.call("/api/state")).json<{
      data: { cars: unknown[]; service: { sum: number; items: unknown[] }[]; fuel: { liters: number; full: boolean }[] };
    }>();
    expect(state.data.cars).toHaveLength(1);
    expect(state.data.service[0].sum).toBe(9000);
    expect(state.data.service[0].items).toHaveLength(2);
    expect(state.data.fuel[0].liters).toBe(37.74);
    expect(state.data.fuel[0].full).toBe(true);
  });

  it("повторна операція не створює дубліката", async () => {
    const { client } = await register();
    const ops = [car(), service("s1")];
    await client.call("/api/ops", { body: { ops } });
    await client.call("/api/ops", { body: { ops } });
    const state = await (await client.call("/api/state")).json<{ data: { service: unknown[] } }>();
    expect(state.data.service).toHaveLength(1);
  });

  it("дві машини з однаковою назвою в різному регістрі створити не можна", async () => {
    const { client } = await register();
    const res = await client.call("/api/ops", {
      body: { ops: [car("a", "Пассат"), car("b", "ПАССАТ")] },
    });
    expect(await res.json()).toEqual({ rejected: [1] });
    const state = await (await client.call("/api/state")).json<{ data: { cars: unknown[] } }>();
    expect(state.data.cars).toHaveLength(1);
  });

  it("запис для неіснуючої машини не блокує решту черги", async () => {
    const { client } = await register();
    const res = await client.call("/api/ops", { body: { ops: [car(), service("bad", "ghost"), service("ok")] } });
    expect(await res.json()).toEqual({ rejected: [1] });
    const state = await (await client.call("/api/state")).json<{ data: { service: { id: string }[] } }>();
    expect(state.data.service.map((s) => s.id)).toEqual(["ok"]);
  });

  it("видалення машини прибирає всі її записи", async () => {
    const { client } = await register();
    await client.call("/api/ops", { body: { ops: [car(), service("s1"), fuelOp("f1")] } });
    await client.call("/api/ops", { body: { ops: [{ type: "car.del", id: "car1" }] } });
    const state = await (await client.call("/api/state")).json<{ data: { cars: unknown[]; service: unknown[]; fuel: unknown[] } }>();
    expect(state.data.cars).toHaveLength(0);
    expect(state.data.service).toHaveLength(0);
    expect(state.data.fuel).toHaveLength(0);
  });

  it("некоректні дані відхиляються", async () => {
    const { client } = await register();
    const bad = { type: "service.put", data: { id: "x", car: "car1", date: "вчора" } };
    expect((await client.call("/api/ops", { body: { ops: [bad] } })).status).toBe(400);
    const neg = fuelOp("f");
    neg.data.liters = -5;
    expect((await client.call("/api/ops", { body: { ops: [neg] } })).status).toBe(400);
  });
});

describe("ізоляція користувачів", () => {
  it("другий користувач не бачить даних першого", async () => {
    const a = await register();
    const b = await register();
    await a.client.call("/api/ops", { body: { ops: [car(), service("s1")] } });
    const state = await (await b.client.call("/api/state")).json<{ data: { cars: unknown[]; service: unknown[] } }>();
    expect(state.data.cars).toHaveLength(0);
    expect(state.data.service).toHaveLength(0);
  });

  it("однакові id у різних користувачів не перезаписують одне одного", async () => {
    const a = await register();
    const b = await register();
    await a.client.call("/api/ops", { body: { ops: [car("same", "Первая"), service("s1", "same")] } });
    await b.client.call("/api/ops", { body: { ops: [car("same", "Вторая"), service("s1", "same")] } });
    await b.client.call("/api/ops", { body: { ops: [{ type: "service.del", id: "s1" }, { type: "car.del", id: "same" }] } });

    const state = await (await a.client.call("/api/state")).json<{
      data: { cars: { name: string }[]; service: unknown[] };
    }>();
    expect(state.data.cars[0].name).toBe("Первая");
    expect(state.data.service).toHaveLength(1);
  });

  it("чужа машина недоступна для запису", async () => {
    const a = await register();
    const b = await register();
    await a.client.call("/api/ops", { body: { ops: [car("mine", "Моя")] } });
    const res = await b.client.call("/api/ops", { body: { ops: [service("s9", "mine")] } });
    expect(await res.json()).toEqual({ rejected: [0] });
  });

  it("чуже фото недоступне", async () => {
    const a = await register();
    const res = await a.client.call("/api/photos/someone-elses/full");
    expect(res.status).toBe(404);
  });

  it("стерти можна лише свої дані", async () => {
    const a = await register();
    const b = await register();
    await a.client.call("/api/ops", { body: { ops: [car()] } });
    await b.client.call("/api/ops", { body: { ops: [{ type: "all.del" }] } });
    const state = await (await a.client.call("/api/state")).json<{ data: { cars: unknown[] } }>();
    expect(state.data.cars).toHaveLength(1);
  });

  it("видалення акаунта прибирає все й вимагає пароль", async () => {
    const { client, email, password } = await register();
    await client.call("/api/ops", { body: { ops: [car(), service("s1")] } });
    expect((await client.call("/api/auth/delete-account", { body: { password: "wrong" } })).status).toBe(400);
    expect((await client.call("/api/auth/delete-account", { body: { password } })).status).toBe(200);
    expect((await newClient().call("/api/auth/login", { body: { email, password } })).status).toBe(401);
  });
});

describe("заголовки й службове", () => {
  it("API не кешується і має заголовки безпеки", async () => {
    const res = await newClient().call("/api/config");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("без налаштувань Google функції Диска вимкнені, а не падають", async () => {
    const config = await (await newClient().call("/api/config")).json<{ drive: boolean; googleLogin: boolean }>();
    expect(config.googleLogin).toBe(false);
    expect(config.drive).toBe(false);
    expect((await newClient().call("/api/google/login")).status).toBe(503);
  });

  it("невідомий шлях API дає 404 у JSON", async () => {
    const res = await newClient().call("/api/nope");
    expect(res.status).toBe(404);
  });
});
