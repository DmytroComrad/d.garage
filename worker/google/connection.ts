import { MESSAGES } from "../../shared/i18n";
import type { Lang } from "../../shared/prefs";
import type { DriveStatus } from "../../shared/types";
import { decryptToken, encryptToken } from "../crypto";
import { ApiError, type Bindings } from "../types";

export const DRIVE_URL = "https://www.googleapis.com/drive/v3/files";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * drive.file — найвужчий доступ: застосунок бачить тільки файли, які створив сам.
 * Решту Диска користувача він не може ні прочитати, ні змінити, ні видалити.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DISCONNECTED = "driveDisconnected";
const GOOGLE_DOWN = "googleDown";
const now = () => Math.floor(Date.now() / 1000);

export const googleConfigured = (env: Bindings): boolean =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.TOKEN_KEY);

export const tokenKey = (env: Bindings): string => {
  if (!env.TOKEN_KEY) throw new ApiError(503, "googleNotConfigured");
  return env.TOKEN_KEY;
};

export type Connection = {
  user_id: string;
  google_email: string | null;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires: number;
  root_folder_id: string | null;
  gallery_folder_id: string | null;
  shots_folder_id: string | null;
  folders_lang: string | null;
  sheet_id: string | null;
  sheet_exported_at: number | null;
};

export const getConnection = (db: D1Database, userId: string): Promise<Connection | null> =>
  db.prepare("SELECT * FROM google_connections WHERE user_id = ?").bind(userId).first<Connection>();

/** Підключення разом із чинним токеном доступу. */
export async function requireDrive(env: Bindings, userId: string): Promise<{ conn: Connection; token: string }> {
  const conn = await getConnection(env.DB, userId);
  if (!conn) throw new ApiError(409, DISCONNECTED, "drive_disconnected");
  return { conn, token: await accessTokenFor(env, conn) };
}

export const sheetUrl = (id: string): string => `https://docs.google.com/spreadsheets/d/${id}/edit`;

export async function driveStatus(db: D1Database, userId: string): Promise<DriveStatus> {
  const conn = await getConnection(db, userId);
  return {
    connected: Boolean(conn),
    email: conn?.google_email ?? null,
    sheetUrl: conn?.sheet_id ? sheetUrl(conn.sheet_id) : null,
    sheetExportedAt: conn?.sheet_exported_at ?? null,
  };
}

async function accessTokenFor(env: Bindings, conn: Connection): Promise<string> {
  const key = tokenKey(env);
  if (conn.access_token_enc && conn.access_expires > now() + 60) {
    return decryptToken(conn.access_token_enc, key, conn.user_id);
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: await decryptToken(conn.refresh_token_enc, key, conn.user_id),
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json<{ access_token?: string; expires_in?: number; error?: string }>().catch(
    (): { access_token?: string; expires_in?: number; error?: string } => ({}),
  );

  if (body.error === "invalid_grant") {
    // Користувач відкликав доступ на боці Google: прибираємо підключення, фото лишаються на його Диску.
    await env.DB.prepare("DELETE FROM google_connections WHERE user_id = ?").bind(conn.user_id).run();
    throw new ApiError(409, "driveRevoked", "drive_disconnected");
  }
  if (!res.ok || !body.access_token) throw new ApiError(502, GOOGLE_DOWN);

  await env.DB.prepare("UPDATE google_connections SET access_token_enc = ?, access_expires = ? WHERE user_id = ?")
    .bind(await encryptToken(body.access_token, key, conn.user_id), now() + (body.expires_in ?? 3600), conn.user_id)
    .run();
  return body.access_token;
}

/**
 * Чи живий файл на Диску. Кошик вважається видаленням: через 30 днів Google зітре файл сам.
 * Тимчасова помилка Google — не видалення, інакше кожен збій плодив би нові папки й таблиці.
 */
export async function driveFileState(token: string, id: string): Promise<"alive" | "gone"> {
  const res = await fetch(`${DRIVE_URL}/${encodeURIComponent(id)}?fields=trashed`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return "gone";
  if (!res.ok) throw new ApiError(502, GOOGLE_DOWN);
  return (await res.json<{ trashed?: boolean }>()).trashed === true ? "gone" : "alive";
}

async function createFolder(token: string, name: string, parent?: string): Promise<string> {
  const res = await fetch(`${DRIVE_URL}?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parent ? [parent] : undefined }),
  });
  if (!res.ok) throw new ApiError(502, "folderFailed");
  return (await res.json<{ id: string }>()).id;
}

/** Перейменування не критичне: якщо Google не відповів, спробуємо наступного разу. */
async function renameFile(token: string, id: string, name: string): Promise<boolean> {
  const res = await fetch(`${DRIVE_URL}/${encodeURIComponent(id)}?fields=id`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

/**
 * Папки: «D.Garage» → «Галерея» (фото з вкладки «Галерея») і «Із записів» (чеки й фото, прикріплені до записів).
 * Назви — мовою користувача. Видалені папки створюємо заново, а наявні перейменовуємо, якщо змінилась мова
 * або вони ще зі старою назвою «Гараж Амедро».
 */
export async function ensureFolders(
  env: Bindings,
  conn: Connection,
  token: string,
  lang: Lang,
): Promise<{ gallery: string; shots: string; root: string }> {
  const names = MESSAGES[lang].driveFolders;
  const existing = async (id: string | null): Promise<string | null> =>
    id && (await driveFileState(token, id)) === "alive" ? id : null;

  const keptRoot = await existing(conn.root_folder_id);
  // Нова коренева папка означає, що старі вкладені теж треба створити.
  const keptGallery = keptRoot && (await existing(conn.gallery_folder_id));
  const keptShots = keptRoot && (await existing(conn.shots_folder_id));
  const root = keptRoot ?? (await createFolder(token, names.root));
  const gallery = keptGallery || (await createFolder(token, names.gallery, root));
  const shots = keptShots || (await createFolder(token, names.records, root));

  let foldersLang: string | null = lang;
  if (conn.folders_lang !== lang) {
    const renamed = await Promise.all([
      keptRoot ? renameFile(token, root, names.root) : true,
      keptGallery ? renameFile(token, gallery, names.gallery) : true,
      keptShots ? renameFile(token, shots, names.records) : true,
    ]);
    // Не вдалось — лишаємо стару позначку, щоб спробувати при наступному завантаженні.
    if (!renamed.every(Boolean)) foldersLang = conn.folders_lang;
  }

  await env.DB.prepare(
    "UPDATE google_connections SET root_folder_id = ?, gallery_folder_id = ?, shots_folder_id = ?, folders_lang = ? WHERE user_id = ?",
  )
    .bind(root, gallery, shots, foldersLang, conn.user_id)
    .run();
  conn.root_folder_id = root;
  conn.gallery_folder_id = gallery;
  conn.shots_folder_id = shots;
  conn.folders_lang = foldersLang;
  return { gallery, shots, root };
}

export async function revokeGoogle(env: Bindings, userId: string): Promise<void> {
  const conn = await getConnection(env.DB, userId);
  if (!conn || !env.TOKEN_KEY) return;
  const token = await decryptToken(conn.refresh_token_enc, env.TOKEN_KEY, userId);
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
}
