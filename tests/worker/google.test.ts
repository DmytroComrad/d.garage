import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";

const APP = "http://localhost";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const googleEnv = {
  ...(env as unknown as Record<string, unknown>),
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
};
const db = (env as unknown as { DB: D1Database }).DB;

type Call = { url: string; init?: RequestInit };

/** Підроблений Google: відповідає за URL і записує кожен виклик. */
let calls: Call[] = [];
let googleHandler: (url: string, init?: RequestInit) => Response | undefined;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const idToken = (claims: Record<string, unknown>) => {
  const bytes = new TextEncoder().encode(JSON.stringify(claims));
  const body = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `x.${body}.y`;
};

beforeEach(() => {
  calls = [];
  googleHandler = () => undefined;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    const handled = googleHandler(url, init);
    if (handled) return handled;
    if (url.startsWith("https://www.googleapis.com/drive/v3/files") && init?.method === "POST") {
      const name = JSON.parse(String(init.body)).name;
      return json({ id: `folder-${name}` });
    }
    if (url.includes("/drive/v3/files/") && url.includes("fields=trashed")) return json({ trashed: false });
    return json({});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Client = {
  cookies: Map<string, string>;
  call: (path: string, init?: { method?: string; body?: unknown; form?: FormData }) => Promise<Response>;
};

const newClient = (): Client => {
  const cookies = new Map<string, string>();
  return {
    cookies,
    call: async (path, { method, body, form } = {}) => {
      const headers: Record<string, string> = {
        origin: APP,
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      };
      if (body !== undefined) headers["content-type"] = "application/json";
      const ctx = createExecutionContext();
      const res = await (worker.fetch as (r: Request, e: unknown, c: ExecutionContext) => Promise<Response>)(
        new Request(`${APP}${path}`, {
          method: method ?? (body !== undefined || form ? "POST" : "GET"),
          headers,
          body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
          redirect: "manual",
        }),
        googleEnv,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(";");
        const eq = pair.indexOf("=");
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        if (value) cookies.set(name, value);
        else cookies.delete(name);
      }
      return res;
    },
  };
};

const register = async (): Promise<{ client: Client; email: string; id: string }> => {
  const client = newClient();
  const email = `g-${crypto.randomUUID().slice(0, 10)}@example.com`;
  const res = await client.call("/api/auth/register", { body: { email, password: "correct horse battery" } });
  const { user } = await res.json<{ user: { id: string } }>();
  return { client, email, id: user.id };
};

/** Проходить весь шлях підключення Диска з підробленим Google. */
const connectDrive = async (client: Client, scope = `openid email ${DRIVE_SCOPE}`) => {
  const start = await client.call("/api/google/drive/connect");
  const location = new URL(start.headers.get("location") ?? "");
  const state = location.searchParams.get("state");
  googleHandler = (url) =>
    url === "https://oauth2.googleapis.com/token"
      ? json({
          access_token: "ACCESS-TOKEN-PLAIN",
          refresh_token: "REFRESH-TOKEN-PLAIN",
          expires_in: 3600,
          scope,
          id_token: idToken({ email: "me@gmail.com" }),
        })
      : undefined;
  const res = await client.call(`/api/google/callback?state=${state}&code=abc`);
  googleHandler = () => undefined;
  return { res, location };
};

const addCar = (client: Client, id = "car1") =>
  client.call("/api/ops", { body: { ops: [{ type: "car.put", data: { id, name: `Машина ${id}` } }] } });

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);

const photoForm = (over: { type?: string; bytes?: Uint8Array; car?: string; kind?: string; recordId?: string; id?: string } = {}) => {
  const form = new FormData();
  form.set("id", over.id ?? "ph1");
  form.set("car", over.car ?? "car1");
  form.set("kind", over.kind ?? "gallery");
  if (over.recordId) form.set("recordId", over.recordId);
  form.set("file", new File([over.bytes ?? pngBytes], "фото.png", { type: over.type ?? "image/png" }));
  return form;
};

describe("вхід через Google", () => {
  it("редирект просить лише профіль, без доступу до Диска, і містить state та PKCE", async () => {
    const res = await newClient().call("/api/google/login");
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location") ?? "");
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP}/api/google/callback`);
  });

  it("неправильний state не доходить до обміну коду на токен", async () => {
    const client = newClient();
    await client.call("/api/google/login");
    const res = await client.call("/api/google/callback?state=forged&code=abc");
    expect(res.headers.get("location")).toBe("/?google=state");
    expect(calls.some((c) => c.url.includes("oauth2.googleapis.com/token"))).toBe(false);
  });

  it("без cookie від старту колбек відхиляється", async () => {
    const res = await newClient().call("/api/google/callback?state=any&code=abc");
    expect(res.headers.get("location")).toBe("/?google=state");
  });

  const loginWith = async (client: Client, claims: Record<string, unknown>) => {
    const start = await client.call("/api/google/login");
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
    googleHandler = (url) =>
      url === "https://oauth2.googleapis.com/token" ? json({ id_token: idToken(claims), access_token: "a" }) : undefined;
    const res = await client.call(`/api/google/callback?state=${state}&code=abc`);
    googleHandler = () => undefined;
    return res;
  };

  it("новий користувач створюється, повторний вхід потрапляє в той самий акаунт", async () => {
    const sub = crypto.randomUUID();
    const email = `new-${sub.slice(0, 8)}@gmail.com`;
    const first = newClient();
    await loginWith(first, { sub, email, email_verified: true, name: "Имя" });
    const state1 = await (await first.call("/api/state")).json<{ user: { id: string; hasGoogle: boolean; hasPassword: boolean } }>();
    expect(state1.user.hasGoogle).toBe(true);
    expect(state1.user.hasPassword).toBe(false);

    const second = newClient();
    await loginWith(second, { sub, email, email_verified: true });
    const state2 = await (await second.call("/api/state")).json<{ user: { id: string } }>();
    expect(state2.user.id).toBe(state1.user.id);
  });

  it("непідтверджена пошта Google не приймається", async () => {
    const res = await loginWith(newClient(), { sub: crypto.randomUUID(), email: "x@gmail.com", email_verified: false });
    expect(res.headers.get("location")).toBe("/?google=unverified");
  });

  it("власник пошти забирає акаунт, який зареєстрував хтось інший: пароль і сесії скасовуються", async () => {
    const attacker = await register();
    const owner = newClient();
    const res = await loginWith(owner, { sub: crypto.randomUUID(), email: attacker.email, email_verified: true });
    expect(res.headers.get("location")).toBe("/?google=claimed");

    expect((await attacker.client.call("/api/state")).status).toBe(401);
    const relogin = await newClient().call("/api/auth/login", {
      body: { email: attacker.email, password: "correct horse battery" },
    });
    expect(relogin.status).toBe(401);
    expect((await owner.call("/api/state")).status).toBe(200);
  });

  it("чужий Диск відключається при такому перехопленні", async () => {
    const attacker = await register();
    await connectDrive(attacker.client);
    const owner = newClient();
    await loginWith(owner, { sub: crypto.randomUUID(), email: attacker.email, email_verified: true });
    const state = await (await owner.call("/api/state")).json<{ drive: { connected: boolean } }>();
    expect(state.drive.connected).toBe(false);
  });
});

describe("підключення Диска", () => {
  it("без входу не починається", async () => {
    expect((await newClient().call("/api/google/drive/connect")).status).toBe(401);
  });

  it("просить лише drive.file і зберігає токени зашифрованими", async () => {
    const { client, id } = await register();
    const { res, location } = await connectDrive(client);
    expect(res.headers.get("location")).toBe("/?drive=connected");
    expect(location.searchParams.get("scope")).toBe(`openid email ${DRIVE_SCOPE}`);
    expect(location.searchParams.get("access_type")).toBe("offline");

    const row = await db
      .prepare("SELECT refresh_token_enc, access_token_enc, gallery_folder_id, shots_folder_id FROM google_connections WHERE user_id = ?")
      .bind(id)
      .first<Record<string, string>>();
    expect(row?.refresh_token_enc).toBeTruthy();
    expect(row?.refresh_token_enc).not.toContain("REFRESH-TOKEN-PLAIN");
    expect(row?.access_token_enc).not.toContain("ACCESS-TOKEN-PLAIN");
    expect(row?.gallery_folder_id).toBe("folder-Галерея");
    expect(row?.shots_folder_id).toBe("folder-Скриншоты");

    const state = await (await client.call("/api/state")).json<{ drive: { connected: boolean; email: string } }>();
    expect(state.drive).toMatchObject({ connected: true, email: "me@gmail.com" });
    expect(JSON.stringify(state)).not.toContain("TOKEN");
  });

  it("без галочки про файли застосунку Диск не підключається", async () => {
    const { client, id } = await register();
    const { res } = await connectDrive(client, "openid email");
    expect(res.headers.get("location")).toBe("/?drive=scope");
    const row = await db.prepare("SELECT 1 FROM google_connections WHERE user_id = ?").bind(id).first();
    expect(row).toBeNull();
  });

  it("чужий користувач не може завершити підключення", async () => {
    const a = await register();
    const b = await register();
    const start = await a.client.call("/api/google/drive/connect");
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
    b.client.cookies.set("g_oauth", a.client.cookies.get("g_oauth") ?? "");
    googleHandler = (url) =>
      url === "https://oauth2.googleapis.com/token"
        ? json({ access_token: "a", refresh_token: "r", scope: DRIVE_SCOPE })
        : undefined;
    const res = await b.client.call(`/api/google/callback?state=${state}&code=abc`);
    expect(res.headers.get("location")).toBe("/?drive=error");
  });

  it("відключення відкликає токен і прибирає підключення", async () => {
    const { client, id } = await register();
    await connectDrive(client);
    const res = await client.call("/api/google/drive/disconnect", { body: {} });
    expect(res.status).toBe(200);
    const revoke = calls.find((c) => c.url.includes("oauth2.googleapis.com/revoke"));
    expect(String(revoke?.init?.body)).toContain("REFRESH-TOKEN-PLAIN");
    expect(await db.prepare("SELECT 1 FROM google_connections WHERE user_id = ?").bind(id).first()).toBeNull();
  });
});

describe("фото", () => {
  const ready = async () => {
    const r = await register();
    await connectDrive(r.client);
    await addCar(r.client);
    return r;
  };

  it("галерея йде в папку «Галерея», а в базі лише текст", async () => {
    const { client, id } = await ready();
    googleHandler = (url) => (url.includes("/upload/drive/v3/files") ? json({ id: "drive-1", name: "фото.png", size: "19" }) : undefined);
    const res = await client.call("/api/photos", { form: photoForm() });
    expect(res.status).toBe(200);

    const upload = calls.find((c) => c.url.includes("/upload/drive/v3/files"));
    const body = await new Response(upload?.init?.body as BodyInit).text();
    expect(body).toContain('"parents":["folder-Галерея"]');

    const row = await db.prepare("SELECT * FROM photos WHERE user_id = ?").bind(id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ drive_id: "drive-1", kind: "gallery", mime: "image/png" });
    expect(Object.values(row ?? {}).some((v) => v instanceof ArrayBuffer)).toBe(false);
  });

  it("фото в записі йде в папку «Скриншоты»", async () => {
    const { client } = await ready();
    googleHandler = (url) => (url.includes("/upload/drive/v3/files") ? json({ id: "drive-2", name: "x", size: "19" }) : undefined);
    await client.call("/api/photos", { form: photoForm({ kind: "record", recordId: "rec1", id: "ph2" }) });
    const upload = calls.find((c) => c.url.includes("/upload/drive/v3/files"));
    const body = await new Response(upload?.init?.body as BodyInit).text();
    expect(body).toContain('"parents":["folder-Скриншоты"]');
  });

  it("SVG і HTML не приймаються, навіть якщо підробити тип", async () => {
    const { client } = await ready();
    const svg = await client.call("/api/photos", {
      form: photoForm({ type: "image/svg+xml", bytes: new TextEncoder().encode("<svg onload=alert(1)>") }),
    });
    expect(svg.status).toBe(415);
    const fake = await client.call("/api/photos", {
      form: photoForm({ type: "image/png", bytes: new TextEncoder().encode("<html><script>alert(1)</script>") }),
    });
    expect(fake.status).toBe(415);
    expect(calls.some((c) => c.url.includes("/upload/"))).toBe(false);
  });

  it("у чужу машину завантажити не можна", async () => {
    const a = await ready();
    const b = await ready();
    await addCar(a.client, "only-a");
    const res = await b.client.call("/api/photos", { form: photoForm({ car: "only-a" }) });
    expect(res.status).toBe(404);
  });

  it("без Диска завантаження пояснює причину", async () => {
    const { client } = await register();
    await addCar(client);
    const res = await client.call("/api/photos", { form: photoForm() });
    expect(res.status).toBe(409);
    expect((await res.json<{ code: string }>()).code).toBe("drive_disconnected");
  });

  it("відкликаний доступ не ламає сайт: Диск стає відключеним, фото лишаються в базі", async () => {
    const { client, id } = await ready();
    googleHandler = (url) => (url.includes("/upload/drive/v3/files") ? json({ id: "drive-3", name: "x", size: "19" }) : undefined);
    await client.call("/api/photos", { form: photoForm({ id: "ph3" }) });
    await db.prepare("UPDATE google_connections SET access_expires = 0 WHERE user_id = ?").bind(id).run();

    googleHandler = (url) => (url === "https://oauth2.googleapis.com/token" ? json({ error: "invalid_grant" }, 400) : undefined);
    const res = await client.call("/api/photos/ph3/full");
    expect(res.status).toBe(409);
    expect(await db.prepare("SELECT 1 FROM google_connections WHERE user_id = ?").bind(id).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM photos WHERE user_id = ? AND id = 'ph3'").bind(id).first()).not.toBeNull();
  });

  it("чуже фото не віддається, своє йде із захисними заголовками", async () => {
    const a = await ready();
    const b = await ready();
    googleHandler = (url) => (url.includes("/upload/drive/v3/files") ? json({ id: "drive-4", name: "x", size: "19" }) : undefined);
    await a.client.call("/api/photos", { form: photoForm({ id: "ph4" }) });

    expect((await b.client.call("/api/photos/ph4/full")).status).toBe(404);

    googleHandler = (url) =>
      url.includes("alt=media") ? new Response(pngBytes, { headers: { "content-type": "text/html" } }) : undefined;
    const own = await a.client.call("/api/photos/ph4/full");
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/png");
    expect(own.headers.get("x-content-type-options")).toBe("nosniff");
    expect(own.headers.get("content-security-policy")).toContain("sandbox");
    expect(own.headers.get("cache-control")).toContain("private");
  });

  it("видалення фото переносить файл у кошик, а не стирає назавжди", async () => {
    const { client } = await ready();
    googleHandler = (url) => (url.includes("/upload/drive/v3/files") ? json({ id: "drive-5", name: "x", size: "19" }) : undefined);
    await client.call("/api/photos", { form: photoForm({ id: "ph5" }) });
    googleHandler = () => undefined;
    expect((await client.call("/api/photos/ph5", { method: "DELETE" })).status).toBe(200);
    const trash = calls.find((c) => c.url.includes("/files/drive-5") && c.init?.method === "PATCH");
    expect(String(trash?.init?.body)).toContain('"trashed":true');
    expect(calls.some((c) => c.url.includes("/files/drive-5") && c.init?.method === "DELETE")).toBe(false);
  });
});

describe("Google Таблиця", () => {
  const seeded = async () => {
    const r = await register();
    await connectDrive(r.client);
    await r.client.call("/api/ops", {
      body: {
        ops: [
          { type: "car.put", data: { id: "car1", name: "Тест" } },
          {
            type: "fuel.put",
            data: { id: "f1", car: "car1", date: "2026-08-21", odo: 327599, liters: 37.74, sum: 2939.95, station: "", full: true, note: "" },
          },
          {
            type: "fuel.put",
            data: { id: "f2", car: "car1", date: "2026-08-31", odo: 328030, liters: 33.8, sum: 2633.02, station: "", full: true, note: "" },
          },
        ],
      },
    });
    return r;
  };

  const sheetsApi = (url: string, init?: RequestInit): Response | undefined => {
    if (!url.startsWith("https://sheets.googleapis.com")) return undefined;
    if (url.includes("?fields=spreadsheetId")) {
      return json({
        spreadsheetId: "sheet-1",
        sheets: ["Сводка", "Обслуживание", "Позиции", "Заправки", "Напоминания"].map((title, i) => ({
          properties: { sheetId: i, title },
        })),
      });
    }
    if (url.includes("fields=sheets.properties") && !init?.method) {
      return json({
        sheets: ["Сводка", "Обслуживание", "Позиции", "Заправки", "Напоминания"].map((title, i) => ({
          properties: { sheetId: i, title },
        })),
      });
    }
    return json({});
  };

  const writes = () =>
    calls
      .filter((c) => c.url.includes("/values:batchUpdate"))
      .map((c) => JSON.parse(String(c.init?.body)) as { valueInputOption: string; data: { range: string; values: unknown[][] }[] });

  it("значення пишуться як числа в режимі RAW і збігаються із сайтом", async () => {
    const { client } = await seeded();
    googleHandler = sheetsApi;
    const res = await client.call("/api/google/sheet/export", { body: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: "https://docs.google.com/spreadsheets/d/sheet-1/edit" });

    const [write] = writes();
    expect(write.valueInputOption).toBe("RAW");
    const tab = (name: string) => write.data.find((d) => d.range === name)?.values ?? [];

    const fuel = tab("Заправки");
    expect(fuel[1][3]).toBe(37.74);
    expect(fuel[1][4]).toBe(2939.95);
    expect(fuel[2][7]).toBe(7.84);

    const summary = tab("Сводка");
    const col = (title: string) => summary[0].indexOf(title);
    expect(summary[1][col("Топливо, ₴")]).toBe(5572.97);
    expect(summary[1][col("Средний расход, л/100")]).toBe(7.84);
  });

  it("таблиця кладеться в папку застосунку, а повторний експорт оновлює ту саму", async () => {
    const { client } = await seeded();
    googleHandler = sheetsApi;
    await client.call("/api/google/sheet/export", { body: {} });
    const move = calls.find((c) => c.url.includes("/files/sheet-1") && c.init?.method === "PATCH");
    expect(move?.url).toContain("addParents=folder-");

    calls = [];
    await client.call("/api/google/sheet/export", { body: {} });
    expect(calls.some((c) => c.url.includes("?fields=spreadsheetId"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/sheet-1/values:batchClear"))).toBe(true);
    expect(writes()).toHaveLength(1);
  });

  it("видалена вручну таблиця створюється заново", async () => {
    const { client } = await seeded();
    googleHandler = sheetsApi;
    await client.call("/api/google/sheet/export", { body: {} });
    calls = [];
    googleHandler = (url, init) =>
      url.includes("/sheet-1?fields=sheets.properties") ? json({ error: {} }, 404) : sheetsApi(url, init);
    const res = await client.call("/api/google/sheet/export", { body: {} });
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.url.includes("?fields=spreadsheetId"))).toBe(true);
  });

  it("відновлення з таблиці повертає дані у форматі бекапу", async () => {
    const { client } = await seeded();
    googleHandler = sheetsApi;
    await client.call("/api/google/sheet/export", { body: {} });
    const [write] = writes();
    googleHandler = (url) =>
      url.includes("values:batchGet")
        ? json({ valueRanges: write.data.map((d) => ({ range: `'${d.range}'!A1:Z99`, values: d.values })) })
        : undefined;
    const res = await client.call("/api/google/sheet/import", { body: {} });
    const { backup } = await res.json<{ backup: { cars: { name: string }[]; fuel: { sum: number; date: string }[] } }>();
    expect(backup.cars[0].name).toBe("Тест");
    expect(backup.fuel[0].sum).toBe(2939.95);
    expect(backup.fuel[0].date).toBe("2026-08-21");
  });

  it("без підключеного Диска експорт пояснює причину", async () => {
    const { client } = await register();
    const res = await client.call("/api/google/sheet/export", { body: {} });
    expect(res.status).toBe(409);
  });
});
