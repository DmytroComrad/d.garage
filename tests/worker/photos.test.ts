import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../../worker/index";

/** Фото в сховищі R2: працює без Google, віддається лише власникові, прибирається разом із записами. */

const APP = "http://localhost";
const base = env as unknown as Record<string, unknown> & { DB: D1Database; MEDIA: R2Bucket };
const db = base.DB;
const media = base.MEDIA;

const jpeg = (fill: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, fill, fill, fill]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
const heic = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 9, 9]);

/** Підроблений Cloudflare Images: «конвертує» будь-що в JPEG і пам'ятає, скільки разів його викликали. */
const fakeImages = () => {
  let transforms = 0;
  const binding = {
    input: () => ({
      transform: (t: { width: number }) => ({
        output: async () => {
          transforms++;
          return { response: () => new Response(jpeg(t.width === 640 ? 6 : 24)) };
        },
      }),
    }),
    info: async () => ({ format: "image/jpeg", fileSize: 15, width: 2400, height: 1800 }),
  };
  return { binding, count: () => transforms };
};

type Client = {
  call: (path: string, init?: { method?: string; body?: unknown; form?: FormData }) => Promise<Response>;
};

const newClient = (extra: Record<string, unknown> = {}): Client => {
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
        { ...base, ...extra },
        ctx,
      );
      await waitOnExecutionContext(ctx);
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return res;
    },
  };
};

const register = async (extra?: Record<string, unknown>) => {
  const client = newClient(extra);
  const email = `p-${crypto.randomUUID().slice(0, 10)}@example.com`;
  const res = await client.call("/api/auth/register", { body: { email, password: "correct horse battery" } });
  const { user } = await res.json<{ user: { id: string } }>();
  await client.call("/api/ops", { body: { ops: [{ type: "car.put", data: { id: "car1", name: "Машина" } }] } });
  return { client, id: user.id };
};

const form = (over: { id?: string; file?: File; thumb?: File | null; car?: string; kind?: string; recordId?: string } = {}) => {
  const f = new FormData();
  f.set("id", over.id ?? "ph1");
  f.set("car", over.car ?? "car1");
  f.set("kind", over.kind ?? "gallery");
  if (over.recordId) f.set("recordId", over.recordId);
  f.set("file", over.file ?? new File([png], "фото.png", { type: "image/png" }));
  if (over.thumb !== null) f.set("thumb", over.thumb ?? new File([jpeg(1)], "thumb.jpg", { type: "image/jpeg" }));
  return f;
};

const stored = async (userId: string, photoId: string) => ({
  full: await media.get(`p/${userId}/${photoId}`),
  thumb: await media.get(`p/${userId}/${photoId}/thumb`),
});

const bytes = async (res: Response) => new Uint8Array(await res.arrayBuffer());

const runCron = async () => {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), base as never, ctx);
  await waitOnExecutionContext(ctx);
};

describe("фото в сховищі", () => {
  it("працюють без Google: фото й мініатюра в сховищі, у базі лише текст", async () => {
    const { client, id } = await register();
    const res = await client.call("/api/photos", { form: form() });
    expect(res.status).toBe(200);
    const { photo } = await res.json<{ photo: { storage: string; driveId: string } }>();
    expect(photo).toMatchObject({ storage: "r2", driveId: "" });

    const row = await db.prepare("SELECT * FROM photos WHERE user_id = ?").bind(id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ storage: "r2", drive_id: "", mime: "image/png", kind: "gallery" });
    const objects = await stored(id, "ph1");
    expect(objects.full?.httpMetadata?.contentType).toBe("image/png");
    expect(objects.thumb?.httpMetadata?.contentType).toBe("image/jpeg");

    expect(await bytes(await client.call("/api/photos/ph1/thumb"))).toEqual(jpeg(1));
    expect(await bytes(await client.call("/api/photos/ph1/full"))).toEqual(png);
  });

  it("без мініатюри замість неї віддається саме фото", async () => {
    const { client } = await register();
    await client.call("/api/photos", { form: form({ thumb: null }) });
    const thumb = await client.call("/api/photos/ph1/thumb");
    expect(thumb.headers.get("content-type")).toBe("image/png");
    expect(await bytes(thumb)).toEqual(png);
  });

  it("мініатюра перевіряється так само суворо: не JPEG не приймається і нічого не зберігається", async () => {
    const { client, id } = await register();
    const html = new File([new TextEncoder().encode("<html><script>alert(1)</script>")], "t.jpg", { type: "image/jpeg" });
    expect((await client.call("/api/photos", { form: form({ thumb: html }) })).status).toBe(415);
    expect((await stored(id, "ph1")).full).toBeNull();
    expect(await db.prepare("SELECT 1 FROM photos WHERE user_id = ?").bind(id).first()).toBeNull();
  });

  it("SVG і HTML не приймаються, навіть якщо підробити тип", async () => {
    const { client, id } = await register();
    const svg = new File([new TextEncoder().encode("<svg onload=alert(1)>")], "x.svg", { type: "image/svg+xml" });
    expect((await client.call("/api/photos", { form: form({ file: svg }) })).status).toBe(415);
    const fake = new File([new TextEncoder().encode("<html><script>alert(1)</script>")], "x.png", { type: "image/png" });
    expect((await client.call("/api/photos", { form: form({ file: fake }) })).status).toBe(415);
    expect((await stored(id, "ph1")).full).toBeNull();
  });

  it("у чужу машину завантажити не можна", async () => {
    const a = await register();
    const b = await register();
    await a.client.call("/api/ops", { body: { ops: [{ type: "car.put", data: { id: "only-a", name: "А" } }] } });
    expect((await b.client.call("/api/photos", { form: form({ car: "only-a" }) })).status).toBe(404);
  });

  it("чуже фото не віддається, своє йде із захисними заголовками", async () => {
    const a = await register();
    const b = await register();
    await a.client.call("/api/photos", { form: form({ id: "ph4" }) });
    expect((await b.client.call("/api/photos/ph4/full")).status).toBe(404);

    const own = await a.client.call("/api/photos/ph4/full");
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/png");
    expect(own.headers.get("x-content-type-options")).toBe("nosniff");
    expect(own.headers.get("content-security-policy")).toContain("sandbox");
    expect(own.headers.get("cache-control")).toContain("private");
  });

  it("видалене фото одразу зникає зі сховища", async () => {
    const { client, id } = await register();
    await client.call("/api/photos", { form: form() });
    expect((await client.call("/api/photos/ph1", { method: "DELETE" })).status).toBe(200);
    expect(await stored(id, "ph1")).toEqual({ full: null, thumb: null });
    expect((await client.call("/api/photos/ph1/full")).status).toBe(404);
  });

  it("фото видаленого запису й машини cron прибирає зі сховища", async () => {
    const { client, id } = await register();
    await client.call("/api/photos", { form: form({ id: "rec-photo", kind: "record", recordId: "s1" }) });
    await client.call("/api/photos", { form: form({ id: "car-photo" }) });

    await client.call("/api/ops", { body: { ops: [{ type: "service.del", id: "s1" }, { type: "car.del", id: "car1" }] } });
    const queued = await db.prepare("SELECT key FROM media_gc WHERE key LIKE ?").bind(`p/${id}/%`).all<{ key: string }>();
    expect(queued.results.map((r) => r.key).sort()).toEqual([`p/${id}/car-photo`, `p/${id}/rec-photo`]);

    await runCron();
    expect(await stored(id, "rec-photo")).toEqual({ full: null, thumb: null });
    expect(await stored(id, "car-photo")).toEqual({ full: null, thumb: null });
    expect(await db.prepare("SELECT 1 FROM media_gc WHERE key LIKE ?").bind(`p/${id}/%`).first()).toBeNull();
  });

  it("видалення акаунта прибирає його фото зі сховища", async () => {
    const { client, id } = await register();
    await client.call("/api/photos", { form: form() });
    const res = await client.call("/api/auth/delete-account", { body: { password: "correct horse battery" } });
    expect(res.status).toBe(200);
    expect(await stored(id, "ph1")).toEqual({ full: null, thumb: null });
  });
});

describe("HEIC з iPhone", () => {
  const heicFile = () => new File([heic], "IMG_0001.HEIC", { type: "image/heic" });

  it("Cloudflare Images переводить його в JPEG із мініатюрою", async () => {
    const images = fakeImages();
    const { client, id } = await register({ IMAGES: images.binding });
    const res = await client.call("/api/photos", { form: form({ file: heicFile(), thumb: null }) });
    expect(res.status).toBe(200);
    const { photo } = await res.json<{ photo: { mime: string; name: string; width: number } }>();
    expect(photo).toMatchObject({ mime: "image/jpeg", name: "IMG_0001.jpg", width: 2400 });
    expect(images.count()).toBe(2);
    const objects = await stored(id, "ph1");
    expect(new Uint8Array(await objects.full!.arrayBuffer())).toEqual(jpeg(24));
    expect(new Uint8Array(await objects.thumb!.arrayBuffer())).toEqual(jpeg(6));
  });

  it("без Images оригінал зберігається як є, а не губиться", async () => {
    const { client, id } = await register();
    const res = await client.call("/api/photos", { form: form({ file: heicFile(), thumb: null }) });
    expect(res.status).toBe(200);
    expect((await stored(id, "ph1")).full?.httpMetadata?.contentType).toBe("image/heic");
  });
});
