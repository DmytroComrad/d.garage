import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateResponse } from "../../shared/types";
import { BACKFILL_PER_RUN, FILL_PER_REQUEST, NBU_URL, backfillBudget, backfillRates, nbuToday } from "../../worker/fx";
import worker from "../../worker/index";
import type { Bindings } from "../../worker/types";

const APP = "http://localhost";
const db = (env as unknown as { DB: D1Database }).DB;
/** Без сталих курсів: Worker іде до «НБУ», якого тут підроблено. */
const nbuEnv = { ...(env as unknown as Bindings), FX_TEST_RATES: "" };
/** Як у wrangler.test.jsonc: сталі курси, жодних звернень назовні. */
const fixedEnv = env as unknown as Bindings;

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
/** Підроблений НБУ: курс залежить від дати, щоб було видно, що кожна дата — своя. */
let nbu: (date: string) => Response;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const dayRates = (date: string) => [
  { r030: 840, txt: "Долар США", rate: 40 + Number(date.slice(6)) / 100, cc: "USD", exchangedate: date },
  { r030: 978, txt: "Євро", rate: 45 + Number(date.slice(6)) / 100, cc: "EUR", exchangedate: date },
  { r030: 826, txt: "Фунт стерлінгів", rate: 52, cc: "GBP", exchangedate: date },
];
const nbuDates = () => calls.filter((c) => c.url.startsWith(NBU_URL)).map((c) => new URL(c.url).searchParams.get("date"));

beforeEach(() => {
  calls = [];
  nbu = (date) => json(dayRates(date));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    if (url.startsWith(NBU_URL)) return nbu(new URL(url).searchParams.get("date") ?? "");
    return new Response("not found", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Client = {
  call: (path: string, init?: { body?: unknown; etag?: string; env?: Bindings }) => Promise<Response>;
};

const newClient = (): Client => {
  let cookie = "";
  return {
    call: async (path, { body, etag, env: useEnv = nbuEnv } = {}) => {
      const headers: Record<string, string> = { origin: APP, "x-lang": "ru" };
      if (cookie) headers.cookie = cookie;
      if (etag) headers["if-none-match"] = etag;
      if (body !== undefined) headers["content-type"] = "application/json";
      const ctx = createExecutionContext();
      const res = await (worker.fetch as (r: Request, e: unknown, c: ExecutionContext) => Promise<Response>)(
        new Request(`${APP}${path}`, {
          method: body !== undefined ? "POST" : "GET",
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
        useEnv,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return res;
    },
  };
};

const register = async (): Promise<Client> => {
  const client = newClient();
  const res = await client.call("/api/auth/register", {
    body: { email: `fx-${crypto.randomUUID().slice(0, 10)}@example.com`, password: "correct horse battery" },
  });
  expect(res.status).toBe(200);
  await client.call("/api/ops", { body: { ops: [{ type: "car.put", data: { id: "car1", name: "Машина" } }] } });
  return client;
};

const state = async (client: Client, opts: { env?: Bindings } = {}) => {
  const res = await client.call("/api/state", opts);
  expect(res.status).toBe(200);
  return { body: await res.json<StateResponse>(), etag: res.headers.get("etag") ?? "" };
};

const service = (id: string, date: string, currency?: string) => ({
  type: "service.put",
  data: {
    id,
    car: "car1",
    date,
    odo: null,
    cat: "Ремонт",
    what: "Ремонт",
    where: "",
    sum: 100,
    ...(currency ? { currency } : {}),
    note: "",
    items: [{ id: "i1", kind: "parts", name: "Деталь", sum: 100 }],
  },
});
const fuel = (id: string, date: string, currency?: string) => ({
  type: "fuel.put",
  data: { id, car: "car1", date, odo: 1000, liters: 40, sum: 50, ...(currency ? { currency } : {}), station: "", full: true, note: "" },
});
const wish = (id: string, added: string, currency?: string) => ({
  type: "wish.put",
  data: {
    id,
    car: "car1",
    title: "Шини",
    price: 300,
    priceMax: 400,
    ...(currency ? { currency } : {}),
    note: "",
    added,
    done: false,
    doneDate: null,
    recordId: null,
  },
});

describe("валюта записів", () => {
  it("зберігається й приходить назад разом із записами", async () => {
    const client = await register();
    const res = await client.call("/api/ops", {
      body: { ops: [service("s1", "2026-01-05", "EUR"), fuel("f1", "2026-01-05", "USD"), wish("w1", "2026-01-05", "EUR")] },
    });
    expect(await res.json()).toEqual({ rejected: [], remapped: {} });
    const { data } = (await state(client)).body;
    expect(data.service[0]).toMatchObject({ currency: "EUR", sum: 100, items: [{ sum: 100 }] });
    expect(data.fuel[0].currency).toBe("USD");
    expect(data.wishes[0]).toMatchObject({ currency: "EUR", price: 300, priceMax: 400 });
  });

  it("невідомий код валюти сервер не приймає", async () => {
    const client = await register();
    for (const op of [service("s1", "2026-01-05", "GBP"), fuel("f1", "2026-01-05", "RUB"), wish("w1", "2026-01-05", "usd")]) {
      const res = await client.call("/api/ops", { body: { ops: [op] } });
      expect(res.status, JSON.stringify(op)).toBe(400);
    }
    const { data } = (await state(client)).body;
    expect([...data.service, ...data.fuel, ...data.wishes]).toHaveLength(0);
  });

  it("старий клієнт без поля валюти: записи в гривнях", async () => {
    const client = await register();
    await client.call("/api/ops", { body: { ops: [service("s1", "2026-01-05"), fuel("f1", "2026-01-05"), wish("w1", "2026-01-05")] } });
    const { data } = (await state(client)).body;
    expect([data.service[0].currency, data.fuel[0].currency, data.wishes[0].currency]).toEqual(["UAH", "UAH", "UAH"]);
  });

  it("зміна валюти — зміна даних: старий ETag уже не дає 304", async () => {
    const client = await register();
    await client.call("/api/ops", { body: { ops: [service("s1", "2026-01-05", "UAH")] } });
    const { etag } = await state(client);
    expect((await client.call("/api/state", { etag })).status).toBe(304);
    await client.call("/api/ops", { body: { ops: [service("s1", "2026-01-05", "USD")] } });
    const res = await client.call("/api/state", { etag });
    expect(res.status).toBe(200);
    expect((await res.json<StateResponse>()).data.service[0].currency).toBe("USD");
  });
});

describe("курси НБУ", () => {
  it("приходять разом із даними: на дати записів, хотілок і на сьогодні", async () => {
    const client = await register();
    await client.call("/api/ops", {
      body: { ops: [service("s1", "2021-03-01", "EUR"), fuel("f1", "2021-03-02"), wish("w1", "2021-03-03", "USD")] },
    });
    const { body } = await state(client);
    expect(body.rates["2021-03-01"]).toEqual({ USD: 40.01, EUR: 45.01 });
    expect(body.rates["2021-03-02"]).toEqual({ USD: 40.02, EUR: 45.02 });
    expect(body.rates["2021-03-03"]).toEqual({ USD: 40.03, EUR: 45.03 });
    expect(body.rates[nbuToday()]).toBeDefined();
  });

  it("НБУ отримує лише дату: без cookie, заголовків і даних людей", async () => {
    const client = await register();
    await client.call("/api/ops", { body: { ops: [service("s1", "2021-04-01", "EUR")] } });
    await state(client);
    const toNbu = calls.filter((c) => c.url.startsWith(NBU_URL));
    expect(toNbu.length).toBeGreaterThan(0);
    for (const call of toNbu) {
      expect(call.url).toMatch(/^https:\/\/bank\.gov\.ua\/NBUStatService\/v1\/statdirectory\/exchange\?date=\d{8}&json$/);
      expect(call.init?.headers).toBeUndefined();
      expect(call.init?.body).toBeUndefined();
      expect(call.init?.method ?? "GET").toBe("GET");
    }
  });

  it("кожна дата запитується один раз, далі — з бази, навіть для інших людей", async () => {
    const a = await register();
    await a.call("/api/ops", { body: { ops: [service("s1", "2021-05-03", "EUR"), fuel("f1", "2021-05-04")] } });
    await state(a);
    expect(nbuDates().filter((d) => d === "20210503" || d === "20210504").sort()).toEqual(["20210503", "20210504"]);

    calls = [];
    const again = (await state(a)).body;
    expect(again.rates["2021-05-03"]).toEqual({ USD: 40.03, EUR: 45.03 });
    const b = await register();
    await b.call("/api/ops", { body: { ops: [service("s1", "2021-05-03", "USD")] } });
    expect((await state(b)).body.rates["2021-05-03"]).toEqual({ USD: 40.03, EUR: 45.03 });
    expect(nbuDates()).not.toContain("20210503");
    expect(nbuDates()).not.toContain("20210504");
  });

  it("за раз дотягується лише кілька дат, решта йде в чергу cron", async () => {
    const client = await register();
    const dates = Array.from({ length: FILL_PER_REQUEST + 4 }, (_, i) => `2020-02-${String(i + 1).padStart(2, "0")}`);
    await client.call("/api/ops", { body: { ops: dates.map((d, i) => service(`s${i}`, d, "EUR")) } });
    const { body, etag } = await state(client);
    const fetched = nbuDates().filter((d) => d?.startsWith("202002"));
    expect(fetched.length).toBeLessThanOrEqual(FILL_PER_REQUEST);
    // Найсвіжіші — першими.
    expect(body.rates["2020-02-10"]).toBeDefined();
    expect(etag).toMatch(/:partial"$/);
    const { results } = await db.prepare("SELECT date FROM fx_queue WHERE date LIKE '2020-02-%'").all<{ date: string }>();
    expect(results.map((r) => r.date).sort()).toEqual(dates.slice(0, dates.length - fetched.length));

    // Cron добирає чергу, і наступний запит отримує повні курси.
    const filled = await backfillRates(nbuEnv);
    expect(filled).toBeGreaterThan(0);
    const { results: left } = await db.prepare("SELECT date FROM fx_queue WHERE date LIKE '2020-02-%'").all();
    expect(left).toHaveLength(0);
    const res = await client.call("/api/state", { etag });
    expect(res.status).toBe(200);
    const full = await res.json<StateResponse>();
    for (const d of dates) expect(full.rates[d], d).toBeDefined();
    expect(res.headers.get("etag")).not.toMatch(/partial/);
    // Повні курси й ті самі дані: тепер 304.
    expect((await client.call("/api/state", { etag: res.headers.get("etag") ?? "" })).status).toBe(304);
  });

  it("НБУ недоступний: дані приходять, а курси дотягнуться пізніше", async () => {
    const client = await register();
    await client.call("/api/ops", { body: { ops: [service("s1", "2019-06-10", "EUR"), fuel("f1", "2019-06-11", "USD")] } });
    nbu = () => new Response("Service Unavailable", { status: 503 });
    const down = await state(client);
    expect(down.body.data.service).toHaveLength(1);
    expect(down.body.data.fuel).toHaveLength(1);
    expect(down.body.rates["2019-06-10"]).toBeUndefined();
    expect(down.etag).toMatch(/:partial"$/);
    // Після першої невдачі нових запитів у цьому ж виклику не роблять.
    expect(nbuDates().length).toBeLessThanOrEqual(3);

    nbu = () => {
      throw new TypeError("network down");
    };
    expect((await state(client)).body.data.service).toHaveLength(1);

    nbu = () => json({ message: "not an array" });
    expect((await state(client)).body.rates["2019-06-10"]).toBeUndefined();

    nbu = (date) => json(dayRates(date));
    const res = await client.call("/api/state", { etag: down.etag });
    expect(res.status).toBe(200);
    expect((await res.json<StateResponse>()).rates["2019-06-10"]).toEqual({ USD: 40.1, EUR: 45.1 });
  });

  it("дата, на яку в НБУ курсів немає, запитується один раз", async () => {
    const client = await register();
    await client.call("/api/ops", { body: { ops: [service("s1", "1997-01-04", "EUR")] } });
    nbu = (date) => (date === "19970104" ? json([]) : json(dayRates(date)));
    const first = await state(client);
    expect(first.body.rates["1997-01-04"]).toBeUndefined();
    expect(first.etag).not.toMatch(/partial/);
    calls = [];
    await state(client);
    expect(nbuDates()).not.toContain("19970104");
  });

  it("сталі курси для тестів не ходять у мережу", async () => {
    const client = await register();
    await client.call("/api/ops", { body: { ops: [service("s1", "2018-07-02", "EUR")] } });
    const { body } = await state(client, { env: fixedEnv });
    expect(body.rates["2018-07-02"]).toEqual({ USD: 41.5, EUR: 48.25 });
    expect(nbuDates()).toHaveLength(0);
  });

  it("сталі курси не діють поза localhost", async () => {
    const client = await register();
    await client.call("/api/ops", { body: { ops: [service("s1", "2018-08-01", "EUR")] } });
    calls = [];
    // Той самий Worker, але з адресою продакшену: курси йдуть від НБУ, а не зі змінної.
    const prod = { ...fixedEnv, APP_URL: "https://garage.example" } as unknown as Bindings;
    const { body } = await state(client, { env: prod });
    expect(nbuDates()).toContain("20180801");
    expect(body.rates["2018-08-01"]).toEqual({ USD: 40.01, EUR: 45.01 });
  });
});

describe("чужі дані", () => {
  it("курси приходять лише на свої дати, а чужий запис змінити не можна", async () => {
    const a = await register();
    const b = await register();
    await a.call("/api/ops", { body: { ops: [service("s1", "2017-09-13", "EUR")] } });
    await state(a);

    const forB = (await state(b)).body;
    expect(forB.rates["2017-09-13"]).toBeUndefined();

    // Той самий id у B — це запис B, а запис A лишається в євро.
    await b.call("/api/ops", { body: { ops: [service("s1", "2017-09-13", "USD")] } });
    expect((await state(a)).body.data.service[0].currency).toBe("EUR");
    expect((await state(b)).body.data.service[0].currency).toBe("USD");
  });
});

describe("cron", () => {
  it("«сьогодні» для курсів — київська дата", () => {
    expect(nbuToday(new Date("2026-11-09T21:30:00Z"))).toBe("2026-11-09");
    // 23:30 за UTC — у Києві вже наступний день.
    expect(nbuToday(new Date("2026-11-09T23:30:00Z"))).toBe("2026-11-10");
    expect(nbuToday(new Date("2026-07-15T21:30:00Z"))).toBe("2026-07-16");
  });

  it("бюджет зовнішніх запитів ділиться з переносом фото", () => {
    expect(backfillBudget(0)).toBe(BACKFILL_PER_RUN);
    expect(backfillBudget(5)).toBe(BACKFILL_PER_RUN);
    expect(backfillBudget(10)).toBe(8);
    expect(backfillBudget(12)).toBe(0);
    expect(backfillBudget(30)).toBe(0);
    // Разом із фото (до 3 запитів і оновлення токена на кожне) — не більше 48 з 50.
    for (let photos = 0; photos <= 12; photos++) expect(4 * photos + backfillBudget(photos)).toBeLessThanOrEqual(48);
  });

  it("спершу сьогоднішній курс, потім черга від нових дат до старих, у межах ліміту", async () => {
    await db.prepare("DELETE FROM fx_queue").run();
    const today = nbuToday();
    await db.prepare("DELETE FROM fx_rates WHERE date = ?").bind(today).run();
    const queued = ["2016-01-01", "2016-01-02", "2016-01-03", "2016-01-04"];
    await db.batch(queued.map((d) => db.prepare("INSERT INTO fx_queue (date) VALUES (?)").bind(d)));

    expect(await backfillRates(nbuEnv, 3)).toBe(3);
    expect(nbuDates()).toEqual(expect.arrayContaining([today.replaceAll("-", ""), "20160104", "20160103"]));
    expect(nbuDates()).toHaveLength(3);
    const { results } = await db.prepare("SELECT date FROM fx_queue").all<{ date: string }>();
    expect(results.map((r) => r.date).sort()).toEqual(["2016-01-01", "2016-01-02"]);
    expect(await backfillRates(nbuEnv, 0)).toBe(0);
  });
});
