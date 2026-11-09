import { Hono } from "hono";
import { z } from "zod";
import { LIMITS } from "../shared/constants";
import type {
  ImportManualsResponse,
  Manual,
  ManualResponse,
  ManualShareResponse,
  SharedManualsResponse,
} from "../shared/types";
import { decryptToken, deriveKey, encryptToken, randomToken, sha256 } from "./crypto";
import { manualFromRow, type ManualRow } from "./data";
import { limitApi, readJson } from "./guard";
import { requireUser } from "./session";
import { ApiError, type AppEnv, type Bindings } from "./types";

/*
 * Мануали: файли будь-якого типу в сховищі R2 і посилання для обміну ними.
 * Файл, який ми не вміємо безпечно показати (не PDF і не картинка), віддається лише як завантаження
 * з типом application/octet-stream: браузер не виконає його як сторінку нашого сайту.
 */

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const manualKey = (userId: string, id: string): string => `m/${userId}/${id}`;
const today = () => new Date().toISOString().slice(0, 10);
const now = () => Math.floor(Date.now() / 1000);

/** Тип визначаємо за вмістом, а не за назвою чи заголовком браузера. */
const sniff = (head: Uint8Array): string => {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return "application/octet-stream";
};

const safeFileName = (name: string): string =>
  name.replace(/[\u0000-\u001f"\\/:*?<>|]+/g, " ").trim().slice(0, 120) || "file";

const fileHeaders = (mime: string, name: string): Headers => {
  const inline = mime === "application/pdf" || mime.startsWith("image/");
  const ascii = name.replace(/[^\x20-\x7e]+/g, "_").replace(/"/g, "");
  const headers = new Headers({
    "Content-Type": mime,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  // Картинки — у пісочниці, як фото. PDF без неї: інакше вбудований переглядач Chrome його не відкриє.
  if (mime.startsWith("image/")) headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  return headers;
};

const ownsCar = (env: Bindings, userId: string, carId: string) =>
  env.DB.prepare("SELECT name FROM cars WHERE user_id = ? AND id = ?").bind(userId, carId).first<{ name: string }>();

const shareUrl = (env: Bindings, token: string): string => `${env.APP_URL}/?manuals=${token}`;

/**
 * Ключ, яким зашифровано токен посилання, щоб власник міг скопіювати його ще раз.
 * Виводимо з PASSWORD_PEPPER, без якого сайт не працює взагалі: обмін мануалами не має залежати від Google (TOKEN_KEY).
 */
const shareKey = (env: Bindings): Promise<string> => {
  if (!env.PASSWORD_PEPPER) throw new ApiError(503, "configuring");
  return deriveKey(env.PASSWORD_PEPPER, "manual-share");
};

export const manuals = new Hono<AppEnv>();
manuals.use("*", requireUser);

manuals.post("/file", async (c) => {
  const user = c.get("user");
  await limitApi(c, `upload:${user.id}`);
  if (Number(c.req.header("content-length") ?? 0) > LIMITS.uploadBytes + 64 * 1024) throw new ApiError(413, "fileTooBig");

  const form = await c.req.formData();
  const file = form.get("file");
  const id = String(form.get("id") ?? "");
  const carId = String(form.get("car") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, LIMITS.noteLength);
  if (!(file instanceof File) || !SAFE_ID.test(id) || !carId || file.size === 0) throw new ApiError(400, "badData");
  if (file.size > LIMITS.uploadBytes) throw new ApiError(413, "fileTooBig");
  const name = safeFileName(file.name);
  const title = String(form.get("title") ?? "").trim().slice(0, LIMITS.titleLength) || name;

  if (!(await ownsCar(c.env, user.id, carId))) throw new ApiError(404, "carNotFound");
  if (user.manuals_count >= LIMITS.manuals) throw new ApiError(413, "manualQuota");

  const bytes = await file.arrayBuffer();
  const mime = sniff(new Uint8Array(bytes.slice(0, 16)));
  await c.env.MEDIA.put(manualKey(user.id, id), bytes, { httpMetadata: { contentType: mime } });

  const row: ManualRow = {
    id,
    car_id: carId,
    title,
    url: null,
    note,
    added: today(),
    file_name: name,
    file_mime: mime,
    file_size: bytes.byteLength,
  };
  await c.env.DB.prepare(
    `INSERT INTO manuals (user_id, id, car_id, title, url, note, added, file_name, file_mime, file_size)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  )
    .bind(user.id, id, carId, title, note, row.added, name, mime, row.file_size)
    .run();
  return c.json({ manual: manualFromRow(row) } satisfies ManualResponse);
});

manuals.get("/:id/file", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT file_name, file_mime FROM manuals WHERE user_id = ? AND id = ?")
    .bind(user.id, c.req.param("id"))
    .first<{ file_name: string | null; file_mime: string | null }>();
  if (!row?.file_name) throw new ApiError(404, "manualNotFound");
  const object = await c.env.MEDIA.get(manualKey(user.id, c.req.param("id")));
  if (!object) throw new ApiError(404, "manualNotFound");
  return new Response(object.body, { headers: fileHeaders(row.file_mime ?? "application/octet-stream", row.file_name) });
});

const carBody = z.object({ car: z.string().regex(SAFE_ID) });

/** Посилання на мануали машини: одне на машину, повторний запит повертає те саме. */
manuals.get("/share", async (c) => {
  const user = c.get("user");
  const car = c.req.query("car") ?? "";
  const row = await c.env.DB.prepare("SELECT token_enc FROM manual_shares WHERE user_id = ? AND car_id = ?")
    .bind(user.id, car)
    .first<{ token_enc: string }>();
  const url = row ? shareUrl(c.env, await decryptToken(row.token_enc, await shareKey(c.env), user.id)) : null;
  return c.json({ url } satisfies ManualShareResponse);
});

manuals.post("/share", async (c) => {
  const user = c.get("user");
  const { car } = await readJson(c, carBody);
  if (!(await ownsCar(c.env, user.id, car))) throw new ApiError(404, "carNotFound");
  const existing = await c.env.DB.prepare("SELECT token_enc FROM manual_shares WHERE user_id = ? AND car_id = ?")
    .bind(user.id, car)
    .first<{ token_enc: string }>();
  if (existing) {
    return c.json({ url: shareUrl(c.env, await decryptToken(existing.token_enc, await shareKey(c.env), user.id)) } satisfies ManualShareResponse);
  }
  const token = randomToken(24);
  await c.env.DB.prepare(
    "INSERT INTO manual_shares (token_hash, token_enc, user_id, car_id, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(await sha256(token), await encryptToken(token, await shareKey(c.env), user.id), user.id, car, now())
    .run();
  return c.json({ url: shareUrl(c.env, token) } satisfies ManualShareResponse);
});

manuals.post("/unshare", async (c) => {
  const user = c.get("user");
  const { car } = await readJson(c, carBody);
  await c.env.DB.prepare("DELETE FROM manual_shares WHERE user_id = ? AND car_id = ?").bind(user.id, car).run();
  return c.json({ url: null } satisfies ManualShareResponse);
});

/** Чужі мануали за посиланням. Бачить їх лише той, хто увійшов: так їх можна одразу додати собі. */
async function findShare(env: Bindings, token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new ApiError(404, "shareNotFound");
  const share = await env.DB.prepare(
    `SELECT s.user_id, s.car_id, c.name AS car_name FROM manual_shares s
     JOIN cars c ON c.user_id = s.user_id AND c.id = s.car_id
     WHERE s.token_hash = ?`,
  )
    .bind(await sha256(token))
    .first<{ user_id: string; car_id: string; car_name: string }>();
  if (!share) throw new ApiError(404, "shareNotFound");
  const { results } = await env.DB.prepare("SELECT * FROM manuals WHERE user_id = ? AND car_id = ? ORDER BY added, id")
    .bind(share.user_id, share.car_id)
    .all<ManualRow>();
  return { share, items: results.map(manualFromRow) };
}

manuals.get("/shared/:token", async (c) => {
  const user = c.get("user");
  await limitApi(c, `shared:${user.id}`);
  const { share, items } = await findShare(c.env, c.req.param("token"));
  return c.json({ carName: share.car_name, own: share.user_id === user.id, items } satisfies SharedManualsResponse);
});

const importBody = z.object({ car: z.string().regex(SAFE_ID), ids: z.array(z.string().regex(SAFE_ID)).min(1).max(100) });

/** Копіює вибрані матеріали собі: посилання — як є, файли — копією у своєму сховищі. */
manuals.post("/shared/:token/import", async (c) => {
  const user = c.get("user");
  await limitApi(c, `shared:${user.id}`);
  const body = await readJson(c, importBody);
  const { share, items } = await findShare(c.env, c.req.param("token"));
  if (!(await ownsCar(c.env, user.id, body.car))) throw new ApiError(404, "carNotFound");

  const wanted = new Set(body.ids);
  const picked = items.filter((m) => wanted.has(m.id));
  if (user.manuals_count + picked.length > LIMITS.manuals) throw new ApiError(413, "manualQuota");

  const added: Manual[] = [];
  for (const item of picked) {
    const id = randomToken(12);
    if (item.file) {
      const object = await c.env.MEDIA.get(manualKey(share.user_id, item.id));
      if (!object) continue;
      await c.env.MEDIA.put(manualKey(user.id, id), await object.arrayBuffer(), {
        httpMetadata: { contentType: item.file.mime },
      });
    }
    const manual: Manual = { ...item, id, car: body.car, added: today() };
    await c.env.DB.prepare(
      `INSERT INTO manuals (user_id, id, car_id, title, url, note, added, file_name, file_mime, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(user.id, id, body.car, manual.title, manual.url, manual.note, manual.added,
        manual.file?.name ?? null, manual.file?.mime ?? null, manual.file?.size ?? null)
      .run();
    added.push(manual);
  }
  return c.json({ manuals: added } satisfies ImportManualsResponse);
});
