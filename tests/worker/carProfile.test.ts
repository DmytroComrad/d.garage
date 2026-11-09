import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { CarProfile, StateResponse } from "../../shared/types";

const ORIGIN = "http://localhost";

const fetchWorker = (path: string, init: RequestInit) =>
  (exports as unknown as { default: { fetch: (url: string, init: RequestInit) => Promise<Response> } }).default.fetch(
    `${ORIGIN}${path}`,
    init,
  );

type Client = { cookie: string; call: (path: string, body?: unknown) => Promise<Response> };

const register = async (): Promise<Client> => {
  const client: Client = {
    cookie: "",
    call: async (path, body) => {
      const headers: Record<string, string> = { origin: ORIGIN };
      if (client.cookie) headers.cookie = client.cookie;
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
  const email = `profile-${crypto.randomUUID().slice(0, 10)}@example.com`;
  const res = await client.call("/api/auth/register", { email, password: "correct horse battery" });
  expect(res.status).toBe(200);
  return client;
};

const ops = (client: Client, ...list: unknown[]) => client.call("/api/ops", { ops: list });
const state = async (client: Client) => (await client.call("/api/state")).json<StateResponse>();

const PROFILE: CarProfile = {
  year: 2012,
  vin: "WVWZZZ1JZ3W386752",
  plate: "AA 1234 BB",
  body: "liftback",
  engine: 1.6,
  fuelType: "lpg_petrol",
  purchaseDate: "2019-04-12",
  purchasePrice: 185000,
  about: "Від першого власника",
};
const EMPTY = Object.fromEntries(Object.keys(PROFILE).map((k) => [k, null]));

const car = { type: "car.put", data: { id: "car1", name: "Ракета" } };
const profile = (data: Record<string, unknown> = {}, id = "car1") => ({
  type: "car.profile",
  id,
  data: { ...PROFILE, ...data },
});

describe("профіль машини", () => {
  it("зберігається й приходить разом із машиною", async () => {
    const client = await register();
    const res = await ops(client, car, profile());
    expect(await res.json()).toEqual({ rejected: [], remapped: {} });
    expect((await state(client)).data.cars).toEqual([{ id: "car1", name: "Ракета", profile: PROFILE }]);
  });

  it("сервер сам нормалізує VIN і номер, а порожній рядок — не вказано", async () => {
    const client = await register();
    await ops(client, car, profile({ vin: " wvw zzz 1jz 3w386752 ", plate: "aa  1234 bb", about: "" }));
    expect((await state(client)).data.cars[0].profile).toEqual({
      ...PROFILE,
      vin: "WVWZZZ1JZ3W386752",
      plate: "AA 1234 BB",
      about: null,
    });
  });

  it("перейменування, і навіть від старого клієнта, профіль не стирає", async () => {
    const client = await register();
    await ops(client, car, profile());
    await ops(client, { type: "car.put", data: { id: "car1", name: "Ластівка" } });
    // Старий клієнт міг надіслати машину з полями, яких не знає сервер: їх просто відкинуто.
    await ops(client, { type: "car.put", data: { id: "car1", name: "Ластівка", profile: null, year: null } });
    expect((await state(client)).data.cars).toEqual([{ id: "car1", name: "Ластівка", profile: PROFILE }]);
  });

  it("порожній профіль прибирає всі поля", async () => {
    const client = await register();
    await ops(client, car, profile());
    await ops(client, { type: "car.profile", id: "car1", data: EMPTY });
    expect((await state(client)).data.cars).toEqual([{ id: "car1", name: "Ракета" }]);
  });

  it("поганий VIN, рік чи майбутню дату покупки сервер не приймає", async () => {
    const client = await register();
    await ops(client, car);
    const nextYear = new Date().getUTCFullYear() + 1;
    for (const bad of [
      { vin: "WVWZZZ1JZ3W38675O" },
      { vin: "AB1" },
      { year: 1899 },
      { year: nextYear + 1 },
      { purchaseDate: `${nextYear + 1}-01-01` },
      { body: "tank" },
      { fuelType: "petrol95" },
      { engine: 0 },
    ]) {
      const res = await ops(client, profile(bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await state(client)).data.cars[0].profile).toBeUndefined();
  });

  it("чужу машину змінити не можна", async () => {
    const owner = await register();
    const stranger = await register();
    await ops(owner, car, profile());

    const res = await ops(stranger, profile({ plate: "HACKED", about: "чужий" }));
    expect(res.status).toBe(200);
    expect((await state(owner)).data.cars[0].profile).toEqual(PROFILE);
    expect((await state(stranger)).data.cars).toEqual([]);

    // У чужого своя машина з тим самим id: зміни лишаються в ній.
    await ops(stranger, car, profile({ plate: "BB0000BB" }));
    expect((await state(owner)).data.cars[0].profile?.plate).toBe("AA 1234 BB");
    expect((await state(stranger)).data.cars[0].profile?.plate).toBe("BB0000BB");
  });

  it("нова машина з наявною назвою зливається з нею разом із профілем", async () => {
    const client = await register();
    await ops(client, car);
    const res = await ops(client, { type: "car.put", data: { id: "offline", name: "ракета" } }, profile({}, "offline"));
    expect(await res.json()).toEqual({ rejected: [], remapped: { offline: "car1" } });
    expect((await state(client)).data.cars).toEqual([{ id: "car1", name: "Ракета", profile: PROFILE }]);
  });

  it("зміна профілю змінює версію даних: застарілий ETag уже не дає 304", async () => {
    const client = await register();
    await ops(client, car);
    const etag = (await client.call("/api/state")).headers.get("etag") ?? "";
    await ops(client, profile());
    const res = await fetchWorker("/api/state", { headers: { cookie: client.cookie, "if-none-match": etag } });
    expect(res.status).toBe(200);
  });
});
