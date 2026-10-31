import { Hono } from "hono";
import { IMAGE_TYPES, LIMITS } from "../../shared/constants";
import type { PhotoResponse } from "../../shared/types";
import { randomToken } from "../crypto";
import { photoFromRow, type PhotoRow } from "../data";
import { limitApi } from "../guard";
import { requireUser } from "../session";
import { ApiError, type AppEnv } from "../types";
import { DRIVE_URL, ensureFolders, getConnection, requireDrive } from "./connection";

const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const TOO_BIG = "Файл слишком большой: максимум 25 МБ.";
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const now = () => Math.floor(Date.now() / 1000);

/** Перші байти файлу: тип за заголовком браузера підробити легко, а SVG чи HTML нам не потрібні. */
const looksLikeImage = (head: Uint8Array, mime: string): boolean => {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  switch (mime) {
    case "image/jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/png":
      return head[0] === 0x89 && ascii(1, 4) === "PNG";
    case "image/gif":
      return ascii(0, 4) === "GIF8";
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "image/heic":
    case "image/heif":
      return ascii(4, 8) === "ftyp";
    default:
      return false;
  }
};

const safeFileName = (name: string): string =>
  name.replace(/[\u0000-\u001f"\\/:*?<>|]+/g, " ").trim().slice(0, 120) || "photo";

const uploadFile = (token: string, file: File, folder: string): Promise<Response> => {
  const boundary = `garage${randomToken(12)}`;
  const metadata = JSON.stringify({ name: safeFileName(file.name), parents: [folder] });
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`;
  return fetch(`${UPLOAD_URL}?uploadType=multipart&fields=id,name,size`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: new Blob([head, file, `\r\n--${boundary}--\r\n`]),
  });
};

const imageHeaders = (mime: string): Headers =>
  new Headers({
    "Content-Type": mime,
    "Cache-Control": "private, max-age=604800, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": "inline",
  });

export const photos = new Hono<AppEnv>();
photos.use("*", requireUser);

photos.post("/", async (c) => {
  const user = c.get("user");
  await limitApi(c, `upload:${user.id}`);

  if (Number(c.req.header("content-length") ?? 0) > LIMITS.uploadBytes) throw new ApiError(413, TOO_BIG);

  const form = await c.req.formData();
  const file = form.get("file");
  const id = String(form.get("id") ?? "");
  const carId = String(form.get("car") ?? "");
  const kind = form.get("kind") === "record" ? "record" : "gallery";
  const recordId = kind === "record" ? String(form.get("recordId") ?? "") : null;
  const width = Number(form.get("width")) || null;
  const height = Number(form.get("height")) || null;

  if (!(file instanceof File) || !SAFE_ID.test(id) || !carId) throw new ApiError(400, "Некорректные данные.");
  if (recordId !== null && !SAFE_ID.test(recordId)) throw new ApiError(400, "Некорректные данные.");
  if (file.size > LIMITS.uploadBytes) throw new ApiError(413, TOO_BIG);
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new ApiError(415, "Можно загружать только фото: JPG, PNG, WebP, GIF или HEIC.");
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!looksLikeImage(head, file.type)) throw new ApiError(415, "Файл не похож на изображение.");

  const db = c.env.DB;
  const owned = await db.prepare("SELECT 1 FROM cars WHERE user_id = ? AND id = ?").bind(user.id, carId).first();
  if (!owned) throw new ApiError(404, "Машина не найдена.");
  if (user.photos_count >= LIMITS.photos) throw new ApiError(413, "Достигнут лимит фото на аккаунт.");

  const { conn, token } = await requireDrive(c.env, user.id);
  const folderFor = (f: { gallery: string; shots: string }) => (kind === "record" ? f.shots : f.gallery);

  const known = kind === "record" ? conn.shots_folder_id : conn.gallery_folder_id;
  let res = await uploadFile(token, file, known ?? folderFor(await ensureFolders(c.env, conn, token)));
  if (res.status === 404) {
    // Папку видалили на Диску: відновлюємо і повторюємо один раз.
    res = await uploadFile(token, file, folderFor(await ensureFolders(c.env, conn, token)));
  }
  if (!res.ok) {
    if (res.status === 403) throw new ApiError(502, "Google Диск отказал: возможно, на нём закончилось место.");
    throw new ApiError(502, "Не получилось загрузить файл на Google Диск.");
  }
  const created = await res.json<{ id: string; name: string; size?: string }>();

  const row: PhotoRow = {
    id,
    car_id: carId,
    kind,
    record_id: recordId,
    drive_id: created.id,
    name: created.name,
    mime: file.type,
    size: Number(created.size ?? file.size),
    width,
    height,
    created_at: now(),
  };
  await db
    .prepare(
      `INSERT INTO photos (user_id, id, car_id, kind, record_id, drive_id, name, mime, size, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(user.id, id, carId, kind, recordId, row.drive_id, row.name, row.mime, row.size, width, height, row.created_at)
    .run();
  return c.json({ photo: photoFromRow(row) } satisfies PhotoResponse);
});

photos.get("/:id/:size{thumb|full}", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT drive_id, mime FROM photos WHERE user_id = ? AND id = ?")
    .bind(user.id, c.req.param("id"))
    .first<{ drive_id: string; mime: string }>();
  if (!row) throw new ApiError(404, "Фото не найдено.");

  const { token } = await requireDrive(c.env, user.id);
  const auth = { Authorization: `Bearer ${token}` };
  const fileUrl = `${DRIVE_URL}/${encodeURIComponent(row.drive_id)}`;

  // HEIC більшість браузерів не показує, тому й повнорозмірне фото беремо як JPEG-мініатюру від Google.
  const isThumb = c.req.param("size") === "thumb";
  if (isThumb || row.mime === "image/heic" || row.mime === "image/heif") {
    const meta = await fetch(`${fileUrl}?fields=thumbnailLink`, { headers: auth });
    if (meta.ok) {
      const { thumbnailLink } = await meta.json<{ thumbnailLink?: string }>();
      if (thumbnailLink && new URL(thumbnailLink).hostname.endsWith(".googleusercontent.com")) {
        const thumb = await fetch(thumbnailLink.replace(/=s\d+$/, isThumb ? "=s640" : "=s2400"), { headers: auth });
        if (thumb.ok) return new Response(thumb.body, { headers: imageHeaders("image/jpeg") });
      }
    }
  }

  const res = await fetch(`${fileUrl}?alt=media`, { headers: auth });
  if (!res.ok) throw new ApiError(404, "Файла больше нет на Google Диске.", "photo_missing");
  return new Response(res.body, { headers: imageHeaders(row.mime) });
});

photos.delete("/:id", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT drive_id FROM photos WHERE user_id = ? AND id = ?")
    .bind(user.id, c.req.param("id"))
    .first<{ drive_id: string }>();
  if (!row) return c.json({ ok: true });

  // У кошик, а не назавжди: користувач ще 30 днів зможе відновити файл на Диску.
  const conn = await getConnection(c.env.DB, user.id);
  if (conn) {
    const { token } = await requireDrive(c.env, user.id);
    await fetch(`${DRIVE_URL}/${encodeURIComponent(row.drive_id)}?fields=id`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    }).catch(() => undefined);
  }
  await c.env.DB.prepare("DELETE FROM photos WHERE user_id = ? AND id = ?").bind(user.id, c.req.param("id")).run();
  return c.json({ ok: true });
});
