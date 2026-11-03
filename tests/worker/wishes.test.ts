import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { StateResponse } from "../../shared/types";

const ORIGIN = "http://localhost";

const fetchWorker = (path: string, init: RequestInit) =>
  (exports as unknown as { default: { fetch: (url: string, init: RequestInit) => Promise<Response> } }).default.fetch(
    `${ORIGIN}${path}`,
    init,
  );

type Client = { cookie: string; call: (path: string, init?: { body?: unknown; lang?: string }) => Promise<Response> };

const newClient = (): Client => {
  const client: Client = {
    cookie: "",
    call: async (path, { body, lang } = {}) => {
      const headers: Record<string, string> = { origin: ORIGIN };
      if (client.cookie) headers.cookie = client.cookie;
      if (lang) headers["x-lang"] = lang;
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await fetchWorker(path, {
        method: body !== undefined ? "POST" : "GET",
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) client.cookie = setCookie.split(";")[0];
      return res;
    },
  };
  return client;
};

const register = async () => {
  const client = newClient();
  const email = `wish-${crypto.randomUUID().slice(0, 10)}@example.com`;
  const res = await client.call("/api/auth/register", { body: { email, password: "correct horse battery" } });
  expect(res.status).toBe(200);
  return client;
};

const state = async (client: Client) => (await client.call("/api/state")).json<StateResponse>();

const car = { type: "car.put", data: { id: "car1", name: "Машина" } };
const record = {
  type: "service.put",
  data: {
    id: "s1",
    car: "car1",
    date: "2026-09-01",
    odo: null,
    cat: "Запчасти / покупки",
    what: "Зимова гума",
    where: "",
    sum: 14000,
    note: "",
    items: [],
  },
};
const wish = (over: Record<string, unknown> = {}) => ({
  type: "wish.put",
  data: {
    id: "w1",
    car: "car1",
    title: "Зимова гума",
    price: 14000,
    links: ["https://rozetka.com.ua/tires"],
    note: "До заморозків",
    added: "2026-09-01",
    done: false,
    doneDate: null,
    recordId: null,
    ...over,
  },
});

describe("хотілки", () => {
  it("зберігаються й приходять разом з усіма даними", async () => {
    const client = await register();
    const res = await client.call("/api/ops", { body: { ops: [car, wish()] } });
    expect(await res.json()).toEqual({ rejected: [], remapped: {} });
    const { data } = await state(client);
    expect(data.wishes).toEqual([wish().data]);

    await client.call("/api/ops", { body: { ops: [{ type: "wish.del", id: "w1" }] } });
    expect((await state(client)).data.wishes).toEqual([]);
  });

  it("виконана хотілка посилається на запис, а видалення запису цей зв'язок прибирає", async () => {
    const client = await register();
    await client.call("/api/ops", {
      body: { ops: [car, record, wish({ done: true, doneDate: "2026-09-01", recordId: "s1" })] },
    });
    expect((await state(client)).data.wishes[0].recordId).toBe("s1");

    await client.call("/api/ops", { body: { ops: [{ type: "service.del", id: "s1" }] } });
    const { data } = await state(client);
    expect(data.service).toEqual([]);
    expect(data.wishes[0]).toMatchObject({ done: true, recordId: null });
  });

  it("небезпечне посилання сервер не приймає", async () => {
    const client = await register();
    const res = await client.call("/api/ops", { body: { ops: [car, wish({ links: ["javascript:alert(1)"] })] } });
    expect(res.status).toBe(400);
  });

  it("машина забирає свої хотілки з собою", async () => {
    const client = await register();
    await client.call("/api/ops", { body: { ops: [car, wish()] } });
    await client.call("/api/ops", { body: { ops: [{ type: "car.del", id: "car1" }] } });
    expect((await state(client)).data.wishes).toEqual([]);
  });

  it("зміна хотілки змінює версію даних: застарілий ETag уже не дає 304", async () => {
    const client = await register();
    await client.call("/api/ops", { body: { ops: [car] } });
    const etag = (await client.call("/api/state")).headers.get("etag") ?? "";
    await client.call("/api/ops", { body: { ops: [wish()] } });
    const res = await fetchWorker("/api/state", { headers: { cookie: client.cookie, "if-none-match": etag } });
    expect(res.status).toBe(200);
  });
});

describe("мова відповідей сервера", () => {
  it("помилка приходить мовою з заголовка X-Lang, без нього — англійською", async () => {
    const client = newClient();
    const body = { email: "nobody@example.com", password: "wrong password" };
    const text = async (lang?: string) =>
      (await (await client.call("/api/auth/login", { body, lang })).json<{ error: string }>()).error;
    expect(await text()).toBe("Wrong email or password.");
    expect(await text("uk")).toBe("Неправильна пошта або пароль.");
    expect(await text("ru")).toBe("Неверная почта или пароль.");
    expect(await text("de")).toBe("Wrong email or password.");
  });

  it("невідомий шлях і відхилений запит теж перекладені", async () => {
    const res = await fetchWorker("/api/nope", { headers: { "x-lang": "uk" } });
    expect(await res.json()).toEqual({ error: "Не знайдено." });
    const rejected = await fetchWorker("/api/ops", { method: "POST", headers: { origin: "https://evil.example", "x-lang": "ru" } });
    expect(await rejected.json()).toEqual({ error: "Запрос отклонён." });
  });
});
