import { Hono } from "hono";
import { IMAGE_TYPES, LIMITS } from "../shared/constants";
import type { PhotoResponse } from "../shared/types";
import { photoFromRow, type PhotoRow } from "./data";
import { DRIVE_URL, getConnection, requireDrive } from "./google/connection";
import { limitApi } from "./guard";
import { convertHeic, deletePhotoObjects, getPhoto, isHeic, migrateOnView, putPhoto, type StoredImage } from "./media";
import { requireUser } from "./session";
import { ApiError, type AppEnv } from "./types";

const TOO_BIG = "fileTooBig";
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Мініатюру робить браузер: JPEG до 640 px важить десятки кілобайт. */
const THUMB_BYTES = 2 * 1024 * 1024;
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

const head = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.slice(0, 16).arrayBuffer());

const safeFileName = (name: string): string =>
  name.replace(/[\u0000-\u001f"\\/:*?<>|]+/g, " ").trim().slice(0, 120) || "photo";

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

  if (Number(c.req.header("content-length") ?? 0) > LIMITS.uploadBytes + THUMB_BYTES) throw new ApiError(413, TOO_BIG);

  const form = await c.req.formData();
  const file = form.get("file");
  const thumb = form.get("thumb");
  const id = String(form.get("id") ?? "");
  const carId = String(form.get("car") ?? "");
  const kind = form.get("kind") === "record" ? "record" : "gallery";
  const recordId = kind === "record" ? String(form.get("recordId") ?? "") : null;
  let width = Number(form.get("width")) || null;
  let height = Number(form.get("height")) || null;

  if (!(file instanceof File) || !SAFE_ID.test(id) || !carId) throw new ApiError(400, "badData");
  if (recordId !== null && !SAFE_ID.test(recordId)) throw new ApiError(400, "badData");
  if (file.size > LIMITS.uploadBytes) throw new ApiError(413, TOO_BIG);
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) throw new ApiError(415, "onlyImages");
  if (!looksLikeImage(await head(file), file.type)) throw new ApiError(415, "notImage");
  // Мініатюра — лише JPEG, який зробив браузер. Будь-що інше відкидаємо так само суворо, як і саме фото.
  if (thumb !== null) {
    if (!(thumb instanceof File) || thumb.size > THUMB_BYTES || !looksLikeImage(await head(thumb), "image/jpeg")) {
      throw new ApiError(415, "notImage");
    }
  }

  const db = c.env.DB;
  const owned = await db.prepare("SELECT 1 FROM cars WHERE user_id = ? AND id = ?").bind(user.id, carId).first();
  if (!owned) throw new ApiError(404, "carNotFound");
  if (user.photos_count >= LIMITS.photos) throw new ApiError(413, "photoQuota");

  const bytes = await file.arrayBuffer();
  let image: StoredImage = {
    body: bytes,
    mime: file.type,
    thumb: thumb instanceof File ? await thumb.arrayBuffer() : null,
    width,
    height,
  };
  if (isHeic(file.type)) image = (await convertHeic(c.env, bytes)) ?? image;
  width = image.width;
  height = image.height;

  await putPhoto(c.env, user.id, id, image);

  const row: PhotoRow = {
    id,
    car_id: carId,
    kind,
    record_id: recordId,
    drive_id: "",
    name: safeFileName(isHeic(image.mime) ? file.name : file.name.replace(/\.(heic|heif)$/i, ".jpg")),
    mime: image.mime,
    size: image.body.byteLength,
    width,
    height,
    created_at: now(),
    storage: "r2",
  };
  await db
    .prepare(
      `INSERT INTO photos (user_id, id, car_id, kind, record_id, drive_id, name, mime, size, width, height, created_at, storage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'r2')`,
    )
    .bind(user.id, id, carId, kind, recordId, "", row.name, row.mime, row.size, width, height, row.created_at)
    .run();
  return c.json({ photo: photoFromRow(row) } satisfies PhotoResponse);
});

photos.get("/:id/:size{thumb|full}", async (c) => {
  const user = c.get("user");
  const size = c.req.param("size") === "thumb" ? "thumb" : "full";
  const row = await c.env.DB.prepare("SELECT id, drive_id, mime, storage FROM photos WHERE user_id = ? AND id = ?")
    .bind(user.id, c.req.param("id"))
    .first<{ id: string; drive_id: string; mime: string; storage: string }>();
  if (!row || row.storage === "missing") throw new ApiError(404, row ? "photoMissing" : "photoNotFound", row ? "photo_missing" : undefined);

  if (row.storage === "drive") {
    // Старе фото ще на Диску: переносимо зараз і одразу віддаємо.
    const image = await migrateOnView(c.env, { user_id: user.id, id: row.id, drive_id: row.drive_id, mime: row.mime });
    const body = size === "thumb" && image.thumb ? image.thumb : image.body;
    return new Response(body, { headers: imageHeaders(size === "thumb" && image.thumb ? "image/jpeg" : image.mime) });
  }

  const object = await getPhoto(c.env, user.id, row.id, size);
  if (!object) throw new ApiError(404, "photoMissing", "photo_missing");
  return new Response(object.body, { headers: imageHeaders(object.httpMetadata?.contentType ?? row.mime) });
});

photos.delete("/:id", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT drive_id FROM photos WHERE user_id = ? AND id = ?")
    .bind(user.id, c.req.param("id"))
    .first<{ drive_id: string }>();
  if (!row) return c.json({ ok: true });

  // Копію на Диску (старі фото) — у кошик, а не назавжди: користувач ще 30 днів зможе її відновити.
  const conn = row.drive_id ? await getConnection(c.env.DB, user.id) : null;
  if (conn) {
    const trash = async () => {
      const { token } = await requireDrive(c.env, user.id);
      await fetch(`${DRIVE_URL}/${encodeURIComponent(row.drive_id)}?fields=id`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      });
    };
    await trash().catch(() => undefined);
  }
  await c.env.DB.prepare("DELETE FROM photos WHERE user_id = ? AND id = ?").bind(user.id, c.req.param("id")).run();
  // Файли в сховищі прибираємо одразу; черга прибирання підстрахує, якщо R2 зараз не відповів.
  await deletePhotoObjects(c.env, user.id, c.req.param("id")).catch(() => undefined);
  return c.json({ ok: true });
});
