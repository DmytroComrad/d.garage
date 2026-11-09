import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
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
  call: (path: string, init?: { method?: string; body?: unknown; form?: FormData; lang?: string }) => Promise<Response>;
};

const newClient = (): Client => {
  const cookies = new Map<string, string>();
  return {
    cookies,
    call: async (path, { method, body, form, lang = "ru" } = {}) => {
      // Ці перевірки писались, коли сайт був лише російською: мову передаємо так само, як застосунок.
      const headers: Record<string, string> = {
        "x-lang": lang,
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
const connectDrive = async (
  client: Client,
  scope = `openid email ${DRIVE_SCOPE}`,
  lang = "ru",
  extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined,
) => {
  const start = await client.call(`/api/google/drive/connect?lang=${lang}`);
  const location = new URL(start.headers.get("location") ?? "");
  const state = location.searchParams.get("state");
  googleHandler = (url, init) =>
    extra(url, init) ??
    (url === "https://oauth2.googleapis.com/token"
      ? json({
          access_token: "ACCESS-TOKEN-PLAIN",
          refresh_token: "REFRESH-TOKEN-PLAIN",
          expires_in: 3600,
          scope,
          id_token: idToken({ email: "me@gmail.com", email_verified: true }),
        })
      : undefined);
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

  it("на https стан входу лежить у __Host-cookie, недоступній сусіднім піддоменам", async () => {
    const ctx = createExecutionContext();
    const res = await (worker.fetch as (r: Request, e: unknown, c: ExecutionContext) => Promise<Response>)(
      new Request("https://garage.test/api/google/login", { redirect: "manual" }),
      googleEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-g_oauth=/);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/;");
    expect(cookie).not.toContain("Domain");
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

  it("Диск без відомої пошти теж відключається при такому перехопленні", async () => {
    const attacker = await register();
    await db
      .prepare("INSERT INTO google_connections (user_id, google_email, refresh_token_enc, connected_at) VALUES (?, NULL, 'x', 0)")
      .bind(attacker.id)
      .run();
    const owner = newClient();
    await loginWith(owner, { sub: crypto.randomUUID(), email: attacker.email, email_verified: true });
    const state = await (await owner.call("/api/state")).json<{ drive: { connected: boolean } }>();
    expect(state.drive.connected).toBe(false);
  });

  it("свій Диск на тій самій пошті лишається підключеним", async () => {
    const { client, email, id } = await register();
    await db
      .prepare("INSERT INTO google_connections (user_id, google_email, refresh_token_enc, connected_at) VALUES (?, ?, 'x', 0)")
      .bind(id, email.toUpperCase())
      .run();
    await client.call("/api/auth/logout", { body: {} });
    const owner = newClient();
    await loginWith(owner, { sub: crypto.randomUUID(), email, email_verified: true });
    const state = await (await owner.call("/api/state")).json<{ drive: { connected: boolean } }>();
    expect(state.drive.connected).toBe(true);
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
    expect(row?.shots_folder_id).toBe("folder-Из записей");

    const state = await (await client.call("/api/state")).json<{ drive: { connected: boolean; email: string } }>();
    expect(state.drive).toMatchObject({ connected: true, email: "me@gmail.com" });
    expect(JSON.stringify(state)).not.toContain("TOKEN");
  });

  it("підміна доступів у посиланні: без підтвердженої пошти Диск не підключається", async () => {
    const { client, id } = await register();
    const start = await client.call("/api/google/drive/connect");
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
    googleHandler = (url) =>
      url === "https://oauth2.googleapis.com/token"
        ? json({ access_token: "a", refresh_token: "r", scope: DRIVE_SCOPE })
        : undefined;
    const res = await client.call(`/api/google/callback?state=${state}&code=abc`);
    expect(res.headers.get("location")).toBe("/?drive=scope");
    expect(await db.prepare("SELECT 1 FROM google_connections WHERE user_id = ?").bind(id).first()).toBeNull();
  });

  it("непідтверджена пошта Google теж не підходить для Диска", async () => {
    const { client, id } = await register();
    const start = await client.call("/api/google/drive/connect");
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
    googleHandler = (url) =>
      url === "https://oauth2.googleapis.com/token"
        ? json({ access_token: "a", refresh_token: "r", scope: DRIVE_SCOPE, id_token: idToken({ email: "x@gmail.com", email_verified: false }) })
        : undefined;
    const res = await client.call(`/api/google/callback?state=${state}&code=abc`);
    expect(res.headers.get("location")).toBe("/?drive=scope");
    expect(await db.prepare("SELECT 1 FROM google_connections WHERE user_id = ?").bind(id).first()).toBeNull();
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

describe("старі фото з Диска", () => {
  const media = (env as unknown as { MEDIA: R2Bucket }).MEDIA;
  const jpegBytes = (fill: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, fill, fill]);

  /** Фото, завантажене до переходу на R2: у базі є, а файл лише на Диску. */
  const seedDrivePhoto = (userId: string, id: string, mime = "image/png") =>
    db
      .prepare(
        `INSERT INTO photos (user_id, id, car_id, kind, record_id, drive_id, name, mime, created_at, storage)
         VALUES (?, ?, 'car1', 'gallery', NULL, ?, 'old.png', ?, 1, 'drive')`,
      )
      .bind(userId, id, `drive-${id}`, mime)
      .run();

  /** Підроблений Диск: мініатюра на googleusercontent.com і сам файл. */
  const driveFiles = (url: string): Response | undefined => {
    if (url.includes("fields=thumbnailLink")) {
      const id = decodeURIComponent(url.split("/files/")[1].split("?")[0]);
      return json({ thumbnailLink: `https://lh3.googleusercontent.com/${id}=s220` });
    }
    if (url.startsWith("https://lh3.googleusercontent.com/")) return new Response(jpegBytes(url.endsWith("=s640") ? 6 : 24));
    if (url.includes("alt=media")) return new Response(pngBytes, { headers: { "content-type": "text/html" } });
    return undefined;
  };

  const ready = async () => {
    const r = await register();
    await connectDrive(r.client);
    await addCar(r.client);
    return r;
  };

  const storage = async (userId: string, id: string) =>
    (await db.prepare("SELECT storage, mime FROM photos WHERE user_id = ? AND id = ?").bind(userId, id).first<{ storage: string; mime: string }>());

  it("переїжджає в сховище при першому ж перегляді, далі Google вже не потрібен", async () => {
    const { client, id } = await ready();
    await seedDrivePhoto(id, "old1");
    googleHandler = driveFiles;

    const first = await client.call("/api/photos/old1/full");
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(pngBytes);
    expect(await storage(id, "old1")).toEqual({ storage: "r2", mime: "image/png" });
    expect(new Uint8Array(await (await media.get(`p/${id}/old1/thumb`))!.arrayBuffer())).toEqual(jpegBytes(6));

    calls = [];
    const thumb = await client.call("/api/photos/old1/thumb");
    expect(new Uint8Array(await thumb.arrayBuffer())).toEqual(jpegBytes(6));
    expect(calls).toEqual([]);
  });

  it("HEIC переїжджає як JPEG-версія від Google, щоб його бачили всі браузери", async () => {
    const { client, id } = await ready();
    await seedDrivePhoto(id, "old-heic", "image/heic");
    googleHandler = driveFiles;
    const res = await client.call("/api/photos/old-heic/full");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(jpegBytes(24));
    expect(await storage(id, "old-heic")).toEqual({ storage: "r2", mime: "image/jpeg" });
    expect(calls.some((c) => c.url.includes("alt=media"))).toBe(false);
  });

  it("cron переносить пачку фото тих, у кого підключено Диск, і не чіпає решту", async () => {
    const a = await ready();
    await seedDrivePhoto(a.id, "a1");
    await seedDrivePhoto(a.id, "a2");
    const b = await register();
    await addCar(b.client);
    await seedDrivePhoto(b.id, "b1");

    googleHandler = driveFiles;
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), googleEnv as never, ctx);
    await waitOnExecutionContext(ctx);

    expect((await storage(a.id, "a1"))?.storage).toBe("r2");
    expect((await storage(a.id, "a2"))?.storage).toBe("r2");
    expect((await storage(b.id, "b1"))?.storage).toBe("drive");
    expect(await media.get(`p/${a.id}/a2`)).not.toBeNull();
  });

  it("фото, якого вже немає на Диску, позначається і більше не смикає Google", async () => {
    const { client, id } = await ready();
    await seedDrivePhoto(id, "gone1");
    googleHandler = (url) => (url.includes("/files/drive-gone1") ? json({ error: {} }, 404) : undefined);
    const res = await client.call("/api/photos/gone1/full");
    expect(res.status).toBe(404);
    expect((await res.json<{ code: string }>()).code).toBe("photo_missing");
    expect((await storage(id, "gone1"))?.storage).toBe("missing");

    calls = [];
    expect((await client.call("/api/photos/gone1/thumb")).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("відкликаний доступ не ламає сайт: Диск стає відключеним, фото чекає в базі", async () => {
    const { client, id } = await ready();
    await seedDrivePhoto(id, "ph3");
    await db.prepare("UPDATE google_connections SET access_expires = 0 WHERE user_id = ?").bind(id).run();

    googleHandler = (url) => (url === "https://oauth2.googleapis.com/token" ? json({ error: "invalid_grant" }, 400) : undefined);
    const res = await client.call("/api/photos/ph3/full");
    expect(res.status).toBe(409);
    expect(await db.prepare("SELECT 1 FROM google_connections WHERE user_id = ?").bind(id).first()).toBeNull();
    expect((await storage(id, "ph3"))?.storage).toBe("drive");
  });

  it("видалення старого фото переносить копію на Диску в кошик, а не стирає назавжди", async () => {
    const { client, id } = await ready();
    await seedDrivePhoto(id, "ph5");
    expect((await client.call("/api/photos/ph5", { method: "DELETE" })).status).toBe(200);
    const trash = calls.find((c) => c.url.includes("/files/drive-ph5") && c.init?.method === "PATCH");
    expect(String(trash?.init?.body)).toContain('"trashed":true');
    expect(calls.some((c) => c.url.includes("/files/drive-ph5") && c.init?.method === "DELETE")).toBe(false);
  });

  it("нове фото не йде на Диск, навіть коли він підключений", async () => {
    const { client } = await ready();
    calls = [];
    expect((await client.call("/api/photos", { form: photoForm() })).status).toBe(200);
    expect(calls.some((c) => c.url.includes("googleapis.com"))).toBe(false);
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
    // Валюта — в окремому стовпці одразу за сумою.
    expect(fuel[0][5]).toBe("Валюта");
    expect(fuel[1][5]).toBe("UAH");
    expect(fuel[2][8]).toBe(7.84);

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

  it("таблиця в кошику вважається видаленою: створюється нова", async () => {
    const { client } = await seeded();
    googleHandler = sheetsApi;
    await client.call("/api/google/sheet/export", { body: {} });
    calls = [];
    googleHandler = (url, init) =>
      url.includes("/files/sheet-1?fields=trashed") ? json({ trashed: true }) : sheetsApi(url, init);
    expect((await client.call("/api/google/sheet/export", { body: {} })).status).toBe(200);
    expect(calls.some((c) => c.url.includes("?fields=spreadsheetId"))).toBe(true);
  });

  it.each([429, 500, 503])("тимчасова помилка Google %i не створює другу таблицю", async (status) => {
    const { client, id } = await seeded();
    googleHandler = sheetsApi;
    await client.call("/api/google/sheet/export", { body: {} });
    calls = [];
    googleHandler = (url, init) =>
      url.includes("/sheet-1?fields=sheets.properties") ? json({ error: {} }, status) : sheetsApi(url, init);
    expect((await client.call("/api/google/sheet/export", { body: {} })).status).toBe(502);
    expect(calls.some((c) => c.url.includes("?fields=spreadsheetId"))).toBe(false);
    const row = await db.prepare("SELECT sheet_id FROM google_connections WHERE user_id = ?").bind(id).first<{ sheet_id: string }>();
    expect(row?.sheet_id).toBe("sheet-1");
  });

  it("тимчасова помилка Диска не плодить папки", async () => {
    const { client } = await seeded();
    calls = [];
    googleHandler = (url) => (url.includes("fields=trashed") ? json({ error: {} }, 503) : sheetsApi(url));
    const res = await client.call("/api/google/sheet/export", { body: {} });
    expect(res.status).toBe(502);
    expect(calls.some((c) => c.url.startsWith("https://www.googleapis.com/drive/v3/files?") && c.init?.method === "POST")).toBe(false);
  });

  it("відновлення працює, навіть якщо один лист видалили", async () => {
    const { client } = await seeded();
    googleHandler = sheetsApi;
    await client.call("/api/google/sheet/export", { body: {} });
    const [write] = writes();
    calls = [];
    googleHandler = (url) => {
      if (url.includes("/sheet-1?fields=sheets.properties")) {
        return json({
          sheets: ["Сводка", "Обслуживание", "Заправки", "Напоминания"].map((title, i) => ({ properties: { sheetId: i, title } })),
        });
      }
      if (url.includes("values:batchGet")) {
        // Запит із відсутнім листом Google відхилив би цілком.
        if (decodeURIComponent(url).includes("Позиции")) return json({ error: "Unable to parse range" }, 400);
        return json({
          valueRanges: write.data
            .filter((d) => d.range !== "Позиции")
            .map((d) => ({ range: `'${d.range}'!A1:Z99`, values: d.values })),
        });
      }
      return undefined;
    };
    const res = await client.call("/api/google/sheet/import", { body: {} });
    expect(res.status).toBe(200);
    expect((await res.json<{ backup: { fuel: unknown[] } }>()).backup.fuel).toHaveLength(2);
  });

  it("відновлення з видаленої таблиці пояснює причину", async () => {
    const { client } = await seeded();
    googleHandler = sheetsApi;
    await client.call("/api/google/sheet/export", { body: {} });
    googleHandler = (url) => (url.includes("/files/sheet-1?fields=trashed") ? json({ trashed: true }) : undefined);
    expect((await client.call("/api/google/sheet/import", { body: {} })).status).toBe(404);
  });

  it("відновлення з таблиці повертає дані у форматі бекапу", async () => {
    const { client } = await seeded();
    googleHandler = sheetsApi;
    await client.call("/api/google/sheet/export", { body: {} });
    const [write] = writes();
    googleHandler = (url) =>
      url.includes("values:batchGet")
        ? json({ valueRanges: write.data.map((d) => ({ range: `'${d.range}'!A1:Z99`, values: d.values })) })
        : sheetsApi(url);
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

describe("назви на Диску мовою користувача", () => {
  const renames = () =>
    calls
      .filter((c) => c.init?.method === "PATCH" && String(c.init?.body ?? "").includes('"name"'))
      .map((c) => ({ id: decodeURIComponent(c.url.split("/files/")[1].split("?")[0]), name: JSON.parse(String(c.init?.body)).name }));
  const foldersLang = (id: string) =>
    db.prepare("SELECT folders_lang FROM google_connections WHERE user_id = ?").bind(id).first<{ folders_lang: string | null }>();

  it("папки створюються мовою сайту, а Google показує екран згоди нею ж", async () => {
    const { client, id } = await register();
    const { location } = await connectDrive(client, undefined, "en");
    expect(location.searchParams.get("hl")).toBe("en");
    const row = await db
      .prepare("SELECT root_folder_id, gallery_folder_id, shots_folder_id FROM google_connections WHERE user_id = ?")
      .bind(id)
      .first<Record<string, string>>();
    expect(row).toEqual({
      root_folder_id: "folder-D.Garage",
      gallery_folder_id: "folder-Gallery",
      shots_folder_id: "folder-From records",
    });
    expect((await foldersLang(id))?.folders_lang).toBe("en");
  });

  it("інша мова: папки перейменовуються при повторному підключенні, і лише один раз", async () => {
    const { client, id } = await register();
    await connectDrive(client, undefined, "en");
    calls = [];
    await connectDrive(client, undefined, "uk");
    expect(renames()).toEqual([
      { id: "folder-D.Garage", name: "D.Garage" },
      { id: "folder-Gallery", name: "Галерея" },
      { id: "folder-From records", name: "Із записів" },
    ]);
    expect((await foldersLang(id))?.folders_lang).toBe("uk");

    calls = [];
    await connectDrive(client, undefined, "uk");
    expect(renames()).toEqual([]);
  });

  it("старі папки «Гараж Амедро» отримують нову назву при наступному підключенні", async () => {
    const { client, id } = await register();
    await connectDrive(client);
    await db.prepare("UPDATE google_connections SET folders_lang = NULL WHERE user_id = ?").bind(id).run();
    calls = [];
    await connectDrive(client);
    expect(renames().map((r) => r.name)).toEqual(["D.Garage", "Галерея", "Из записей"]);
    expect((await foldersLang(id))?.folders_lang).toBe("ru");
  });

  it("Google не відповів на перейменування: спробуємо наступного разу", async () => {
    const { client, id } = await register();
    await connectDrive(client, undefined, "en");
    const res = await connectDrive(client, undefined, "uk", (_url, init) =>
      init?.method === "PATCH" ? json({ error: {} }, 503) : undefined,
    );
    expect(res.res.headers.get("location")).toBe("/?drive=connected");
    expect((await foldersLang(id))?.folders_lang).toBe("en");
  });
});

describe("Google Таблиця іншою мовою", () => {
  const ruTabs = ["Сводка", "Обслуживание", "Позиции", "Заправки", "Напоминания", "Хотелки"];

  it("листи й назва файлу — мовою сайту, а листи старою мовою прибираються", async () => {
    const { client } = await register();
    await connectDrive(client);
    await addCar(client);
    googleHandler = (url, init) => {
      if (!url.startsWith("https://sheets.googleapis.com")) return undefined;
      if (url.includes("?fields=spreadsheetId")) {
        return json({ spreadsheetId: "sheet-uk", sheets: ruTabs.map((title, i) => ({ properties: { sheetId: i, title } })) });
      }
      if (url.includes("fields=sheets.properties") && !init?.method) {
        return json({ sheets: ruTabs.map((title, i) => ({ properties: { sheetId: i, title } })) });
      }
      if (url.endsWith(":batchUpdate") && String(init?.body).includes("addSheet")) {
        const requests = JSON.parse(String(init?.body)).requests as { addSheet?: { properties: { title: string } } }[];
        return json({
          replies: requests.map((r, i) => (r.addSheet ? { addSheet: { properties: { sheetId: 100 + i, title: r.addSheet.properties.title } } } : {})),
        });
      }
      return json({});
    };
    await client.call("/api/google/sheet/export", { body: {} });
    calls = [];
    const res = await client.call("/api/google/sheet/export", { body: { dateFormat: "mdy" }, lang: "uk" });
    expect(res.status).toBe(200);

    const structure = calls.find((c) => c.url.endsWith(":batchUpdate") && String(c.init?.body).includes("addSheet"));
    const requests = JSON.parse(String(structure?.init?.body)).requests as Record<string, { sheetId?: number; properties?: { title: string } }>[];
    const added = requests.flatMap((r) => (r.addSheet ? [r.addSheet.properties?.title] : []));
    const deleted = requests.flatMap((r) => (r.deleteSheet ? [r.deleteSheet.sheetId] : []));
    // «Заправки» однакові українською й російською: цей лист лишається. «Контактів» у старій таблиці ще не було.
    expect(added).toEqual(["Зведення", "Обслуговування", "Позиції", "Нагадування", "Хотілки", "Контакти"]);
    expect(deleted).toEqual([0, 1, 2, 4, 5]);

    const write = calls.find((c) => c.url.includes("/values:batchUpdate"));
    const ranges = (JSON.parse(String(write?.init?.body)).data as { range: string }[]).map((d) => d.range);
    expect(ranges).toContain("Зведення");

    const format = calls.find((c) => c.url.endsWith(":batchUpdate") && String(c.init?.body).includes("updateSpreadsheetProperties"));
    const body = String(format?.init?.body);
    expect(body).toContain('"title":"D.Garage: бекап"');
    expect(body).toContain('"locale":"uk_UA"');
    expect(body).toContain('"pattern":"mm/dd/yyyy"');
  });
});
