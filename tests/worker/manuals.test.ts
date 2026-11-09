import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../../worker/index";
import type { Manual, SharedManualsResponse } from "../../shared/types";

/** Мануали: посилання й файли будь-якого типу, безпечна видача, обмін за посиланням. */

const APP = "http://localhost";
const base = env as unknown as Record<string, unknown> & { DB: D1Database; MEDIA: R2Bucket };
const db = base.DB;
const media = base.MEDIA;

type Client = { call: (path: string, init?: { method?: string; body?: unknown; form?: FormData }) => Promise<Response> };

const newClient = (): Client => {
  let cookie = "";
  return {
    call: async (path, { method, body, form } = {}) => {
      const headers: Record<string, string> = { origin: APP, cookie, "x-lang": "uk" };
      if (body !== undefined) headers["content-type"] = "application/json";
      const ctx = createExecutionContext();
      const res = await (worker.fetch as (r: Request, e: unknown, c: ExecutionContext) => Promise<Response>)(
        new Request(`${APP}${path}`, {
          method: method ?? (body !== undefined || form ? "POST" : "GET"),
          headers,
          body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
        }),
        base,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return res;
    },
  };
};

const register = async () => {
  const client = newClient();
  const email = `m-${crypto.randomUUID().slice(0, 10)}@example.com`;
  const res = await client.call("/api/auth/register", { body: { email, password: "correct horse battery" } });
  const { user } = await res.json<{ user: { id: string } }>();
  await client.call("/api/ops", { body: { ops: [{ type: "car.put", data: { id: "car1", name: "Машина" } }] } });
  return { client, id: user.id };
};

const upload = (client: Client, over: { id?: string; name?: string; bytes?: Uint8Array; title?: string; car?: string } = {}) => {
  const form = new FormData();
  form.set("id", over.id ?? "m1");
  form.set("car", over.car ?? "car1");
  if (over.title) form.set("title", over.title);
  form.set("file", new File([over.bytes ?? new TextEncoder().encode("%PDF-1.7\nhello")], over.name ?? "Мануал.pdf"));
  return client.call("/api/manuals/file", { form });
};

const link = (over: Partial<Manual> = {}) => ({
  type: "manual.put",
  data: { id: "l1", car: "car1", title: "Схема підвіски", url: "https://example.com/scheme", note: "", added: "2026-11-01", ...over },
});

const state = async (client: Client) => (await (await client.call("/api/state")).json<{ data: { manuals: Manual[] } }>()).data.manuals;

describe("мануали", () => {
  it("посилання й нотатки зберігаються через звичайні операції", async () => {
    const { client } = await register();
    const res = await client.call("/api/ops", { body: { ops: [link(), link({ id: "n1", title: "Тиск у шинах: 2,2", url: null })] } });
    expect(res.status).toBe(200);
    expect(await state(client)).toEqual([
      expect.objectContaining({ id: "l1", url: "https://example.com/scheme", file: null }),
      expect.objectContaining({ id: "n1", url: null, file: null }),
    ]);
    const bad = await client.call("/api/ops", { body: { ops: [link({ id: "x", url: "javascript:alert(1)" })] } });
    expect(bad.status).toBe(400);
  });

  it("PDF зберігається в сховищі й відкривається в браузері, а не як сторінка сайту", async () => {
    const { client, id } = await register();
    const res = await upload(client);
    expect(res.status).toBe(200);
    const { manual } = await res.json<{ manual: Manual }>();
    expect(manual).toMatchObject({ title: "Мануал.pdf", url: null, file: { name: "Мануал.pdf", mime: "application/pdf", size: 14 } });
    expect(await media.get(`m/${id}/m1`)).not.toBeNull();

    const file = await client.call("/api/manuals/m1/file");
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("content-disposition")).toContain("inline");
    expect(file.headers.get("content-disposition")).toContain("filename*=UTF-8''%D0%9C");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("HTML, SVG та інші файли віддаються лише як завантаження, що б не казала назва", async () => {
    const { client } = await register();
    for (const [id, name, text] of [
      ["h1", "page.html", "<html><script>alert(1)</script>"],
      ["s1", "logo.svg", "<svg onload=alert(1)>"],
      ["p1", "fake.pdf", "<html>not a pdf"],
    ]) {
      await upload(client, { id, name, bytes: new TextEncoder().encode(text) });
      const res = await client.call(`/api/manuals/${id}/file`);
      expect(res.headers.get("content-type"), name).toBe("application/octet-stream");
      expect(res.headers.get("content-disposition"), name).toMatch(/^attachment/);
    }
  });

  it("картинка показується в пісочниці, як фото", async () => {
    const { client } = await register();
    await upload(client, { id: "i1", name: "схема.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]) });
    const res = await client.call("/api/manuals/i1/file");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("чужий файл не віддається, у чужу машину не завантажити", async () => {
    const a = await register();
    const b = await register();
    await upload(a.client, { id: "secret" });
    expect((await b.client.call("/api/manuals/secret/file")).status).toBe(404);
    await a.client.call("/api/ops", { body: { ops: [{ type: "car.put", data: { id: "only-a", name: "А" } }] } });
    expect((await upload(b.client, { car: "only-a" })).status).toBe(404);
  });

  it("зміна назви не чіпає файл, а видалений мануал cron прибирає зі сховища", async () => {
    const { client, id } = await register();
    await upload(client);
    await client.call("/api/ops", { body: { ops: [link({ id: "m1", title: "Нова назва", url: "https://evil.example/x" })] } });
    const [manual] = await state(client);
    expect(manual).toMatchObject({ title: "Нова назва", url: null, file: { name: "Мануал.pdf" } });

    await client.call("/api/ops", { body: { ops: [{ type: "manual.del", id: "m1" }] } });
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), base as never, ctx);
    await waitOnExecutionContext(ctx);
    expect(await media.get(`m/${id}/m1`)).toBeNull();
  });
});

describe("обмін мануалами", () => {
  it("власник отримує одне й те саме посилання, інший користувач бачить список і копіює вибране собі", async () => {
    const owner = await register();
    await upload(owner.client, { id: "pdf1" });
    await owner.client.call("/api/ops", { body: { ops: [link()] } });

    const first = await (await owner.client.call("/api/manuals/share", { body: { car: "car1" } })).json<{ url: string }>();
    const again = await (await owner.client.call("/api/manuals/share", { body: { car: "car1" } })).json<{ url: string }>();
    expect(again.url).toBe(first.url);
    expect((await (await owner.client.call("/api/manuals/share?car=car1")).json<{ url: string }>()).url).toBe(first.url);
    const token = new URL(first.url).searchParams.get("manuals") ?? "";
    expect(first.url.startsWith("http://localhost/?manuals=")).toBe(true);

    const guest = await register();
    const listed = await (await guest.client.call(`/api/manuals/shared/${token}`)).json<SharedManualsResponse>();
    expect(listed).toMatchObject({ carName: "Машина", own: false });
    expect(listed.items.map((m) => m.id).sort()).toEqual(["l1", "pdf1"]);

    const res = await guest.client.call(`/api/manuals/shared/${token}/import`, { body: { car: "car1", ids: ["pdf1"] } });
    expect(res.status).toBe(200);
    const [copy] = (await res.json<{ manuals: Manual[] }>()).manuals;
    expect(copy.id).not.toBe("pdf1");
    expect(copy.file?.name).toBe("Мануал.pdf");
    const file = await guest.client.call(`/api/manuals/${copy.id}/file`);
    expect(await file.text()).toBe("%PDF-1.7\nhello");
    expect((await state(guest.client)).map((m) => m.title)).toEqual(["Мануал.pdf"]);
  });

  it("без входу список не видно, а вимкнене посилання більше не працює", async () => {
    const owner = await register();
    const { url } = await (await owner.client.call("/api/manuals/share", { body: { car: "car1" } })).json<{ url: string }>();
    const token = new URL(url).searchParams.get("manuals") ?? "";
    expect((await newClient().call(`/api/manuals/shared/${token}`)).status).toBe(401);

    await owner.client.call("/api/manuals/unshare", { body: { car: "car1" } });
    const guest = await register();
    const res = await guest.client.call(`/api/manuals/shared/${token}`);
    expect(res.status).toBe(404);
    expect((await guest.client.call("/api/manuals/shared/not-a-real-token-1234567")).status).toBe(404);
    expect(await db.prepare("SELECT 1 FROM manual_shares WHERE user_id = ?").bind(owner.id).first()).toBeNull();
  });

  it("поділитися можна лише своєю машиною, а скопіювати — лише у свою", async () => {
    const owner = await register();
    const guest = await register();
    expect((await guest.client.call("/api/manuals/share", { body: { car: "nope" } })).status).toBe(404);
    const { url } = await (await owner.client.call("/api/manuals/share", { body: { car: "car1" } })).json<{ url: string }>();
    const token = new URL(url).searchParams.get("manuals") ?? "";
    await owner.client.call("/api/ops", { body: { ops: [link()] } });
    const res = await guest.client.call(`/api/manuals/shared/${token}/import`, { body: { car: "someone-else", ids: ["l1"] } });
    expect(res.status).toBe(404);
  });
});
