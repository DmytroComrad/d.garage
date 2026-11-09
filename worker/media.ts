import { ApiError, type Bindings } from "./types";
import { DRIVE_URL, requireDrive } from "./google/connection";

/*
 * Сховище фото в R2. Бакет приватний: файли віддає лише Worker, перевіривши власника.
 * Ключі будуються з id користувача й фото, тож у базі шлях окремо не зберігається:
 *   p/<user>/<photo>        — саме фото (JPEG до 2400 px, GIF чи PNG як є);
 *   p/<user>/<photo>/thumb  — мініатюра JPEG до 640 px, якщо вона є.
 */

export const photoKey = (userId: string, photoId: string): string => `p/${userId}/${photoId}`;
export const thumbKey = (userId: string, photoId: string): string => `${photoKey(userId, photoId)}/thumb`;

const HEIC = new Set(["image/heic", "image/heif"]);
export const isHeic = (mime: string): boolean => HEIC.has(mime);

export type StoredImage = { body: ArrayBuffer; mime: string; thumb: ArrayBuffer | null; width: number | null; height: number | null };

/**
 * HEIC з iPhone, який браузер не зміг перекодувати сам (Chrome на ПК), переводимо в JPEG через Cloudflare Images:
 * інакше фото видно лише в Safari. Без Images або понад безкоштовну квоту лишаємо оригінал.
 */
export async function convertHeic(env: Bindings, file: ArrayBuffer): Promise<StoredImage | null> {
  const images = env.IMAGES;
  if (!images) return null;
  try {
    const render = async (side: number, quality: number): Promise<ArrayBuffer> => {
      const result = await images
        .input(new Blob([file]).stream())
        .transform({ width: side, height: side, fit: "scale-down" })
        .output({ format: "image/jpeg", quality });
      return result.response().arrayBuffer();
    };
    const body = await render(2400, 85);
    const thumb = await render(640, 80);
    const info = await images.info(new Blob([body]).stream());
    const size = "width" in info ? { width: info.width, height: info.height } : { width: null, height: null };
    return { body, mime: "image/jpeg", thumb, ...size };
  } catch {
    return null;
  }
}

export async function putPhoto(env: Bindings, userId: string, photoId: string, image: StoredImage): Promise<void> {
  await env.MEDIA.put(photoKey(userId, photoId), image.body, { httpMetadata: { contentType: image.mime } });
  if (image.thumb) {
    await env.MEDIA.put(thumbKey(userId, photoId), image.thumb, { httpMetadata: { contentType: "image/jpeg" } });
  }
}

/** Мініатюри може не бути (GIF, старий HEIC без Images): тоді віддаємо саме фото. */
export async function getPhoto(env: Bindings, userId: string, photoId: string, size: "thumb" | "full") {
  if (size === "thumb") {
    const thumb = await env.MEDIA.get(thumbKey(userId, photoId));
    if (thumb) return thumb;
  }
  return env.MEDIA.get(photoKey(userId, photoId));
}

export const deletePhotoObjects = (env: Bindings, userId: string, photoId: string): Promise<void> =>
  env.MEDIA.delete([photoKey(userId, photoId), thumbKey(userId, photoId)]);

/**
 * Розбирає чергу прибирання: файли фото, яких уже немає в базі.
 * R2 видаляє до 1000 ключів за раз, а D1 приймає до 100 параметрів у запиті: звідси шматки по 90 фото.
 */
export async function collectGarbage(env: Bindings, limit = 450): Promise<number> {
  const { results } = await env.DB.prepare("SELECT key FROM media_gc LIMIT ?").bind(limit).all<{ key: string }>();
  const keys = results.map((r) => r.key);
  for (let i = 0; i < keys.length; i += 90) {
    const chunk = keys.slice(i, i + 90);
    await env.MEDIA.delete(chunk.flatMap((k) => [k, `${k}/thumb`]));
    await env.DB.prepare(`DELETE FROM media_gc WHERE key IN (${chunk.map(() => "?").join(", ")})`)
      .bind(...chunk)
      .run();
  }
  return keys.length;
}

type DrivePhoto = { user_id: string; id: string; drive_id: string; mime: string };

/** Мініатюра від Google потрібного розміру: =s640 для мініатюри, =s2400 як JPEG-версія HEIC. */
async function driveThumbnail(token: string, driveId: string, side: number): Promise<ArrayBuffer | "gone" | null> {
  const auth = { Authorization: `Bearer ${token}` };
  const meta = await fetch(`${DRIVE_URL}/${encodeURIComponent(driveId)}?fields=thumbnailLink`, { headers: auth });
  if (meta.status === 404) return "gone";
  if (!meta.ok) return null;
  const { thumbnailLink } = await meta.json<{ thumbnailLink?: string }>();
  if (!thumbnailLink || !new URL(thumbnailLink).hostname.endsWith(".googleusercontent.com")) return null;
  const res = await fetch(thumbnailLink.replace(/=s\d+$/, `=s${side}`), { headers: auth });
  return res.ok ? res.arrayBuffer() : null;
}

/**
 * Переносить одне фото з Диска в R2. Файл на Диску лишається: це копія користувача.
 * HEIC зберігаємо як JPEG-версію від Google, щоб його бачили всі браузери.
 * Повертає те, що збережено, або причину, чому ні.
 */
export async function migrateFromDrive(
  env: Bindings,
  token: string,
  photo: DrivePhoto,
): Promise<{ status: "moved"; image: StoredImage } | { status: "gone" } | { status: "failed" }> {
  const thumb = await driveThumbnail(token, photo.drive_id, 640);
  if (thumb === "gone") return markMissing(env, photo);

  let body: ArrayBuffer;
  let mime = photo.mime;
  if (isHeic(photo.mime)) {
    const jpeg = await driveThumbnail(token, photo.drive_id, 2400);
    if (jpeg === "gone") return markMissing(env, photo);
    if (!jpeg) return { status: "failed" };
    body = jpeg;
    mime = "image/jpeg";
  } else {
    const res = await fetch(`${DRIVE_URL}/${encodeURIComponent(photo.drive_id)}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return markMissing(env, photo);
    if (!res.ok) return { status: "failed" };
    body = await res.arrayBuffer();
  }

  const image: StoredImage = { body, mime, thumb: thumb ?? null, width: null, height: null };
  await putPhoto(env, photo.user_id, photo.id, image);
  await env.DB.prepare("UPDATE photos SET storage = 'r2', mime = ? WHERE user_id = ? AND id = ? AND storage = 'drive'")
    .bind(mime, photo.user_id, photo.id)
    .run();
  return { status: "moved", image };
}

async function markMissing(env: Bindings, photo: DrivePhoto): Promise<{ status: "gone" }> {
  await env.DB.prepare("UPDATE photos SET storage = 'missing' WHERE user_id = ? AND id = ? AND storage = 'drive'")
    .bind(photo.user_id, photo.id)
    .run();
  return { status: "gone" };
}

/**
 * Фоновий перенос: невелика пачка за раз, бо безкоштовний план дає 50 зовнішніх запитів на виклик,
 * а на фото їх іде до трьох. Беремо лише тих, у кого Диск підключений: відкликаний доступ
 * прибирає підключення, і таких користувачів cron більше не чіпає, поки вони не підключаться знову.
 */
export async function migrateBatch(env: Bindings, limit = 12): Promise<{ moved: number; gone: number; failed: number }> {
  const { results } = await env.DB.prepare(
    `SELECT p.user_id, p.id, p.drive_id, p.mime FROM photos p
     JOIN google_connections g ON g.user_id = p.user_id
     WHERE p.storage = 'drive' LIMIT ?`,
  )
    .bind(limit)
    .all<DrivePhoto>();

  const tokens = new Map<string, string | null>();
  const totals = { moved: 0, gone: 0, failed: 0 };
  for (const photo of results) {
    if (!tokens.has(photo.user_id)) {
      tokens.set(photo.user_id, await requireDrive(env, photo.user_id).then((d) => d.token, () => null));
    }
    const token = tokens.get(photo.user_id);
    if (!token) {
      totals.failed++;
      continue;
    }
    const result = await migrateFromDrive(env, token, photo).catch((): { status: "failed" } => ({ status: "failed" }));
    if (result.status === "moved") totals.moved++;
    else if (result.status === "gone") totals.gone++;
    else totals.failed++;
  }
  return totals;
}

/** Фото, яке ще на Диску, переносимо при першому ж перегляді. Без Диска пояснюємо причину. */
export async function migrateOnView(env: Bindings, photo: DrivePhoto): Promise<StoredImage> {
  const { token } = await requireDrive(env, photo.user_id);
  const result = await migrateFromDrive(env, token, photo);
  if (result.status === "moved") return result.image;
  if (result.status === "gone") throw new ApiError(404, "photoMissing", "photo_missing");
  throw new ApiError(502, "googleDown");
}
