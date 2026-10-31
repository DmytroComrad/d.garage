import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { IMAGE_TYPES, LIMITS } from "../shared/constants";
import { todayISO } from "../shared/format";
import { SHEET_TITLES, buildSheets, sheetValues, sheetsToBackup, type Column, type Sheet } from "../shared/sheet";
import { decryptToken, encryptToken, pkceChallenge, randomToken } from "./crypto";
import { loadGarage, photoFromRow, type PhotoRow } from "./data";
import { limitApi } from "./guard";
import { createSession, loadUser, requireUser } from "./session";
import { ApiError, type AppEnv, type Bindings } from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";

/**
 * drive.file — найвужчий доступ: застосунок бачить тільки файли, які створив сам.
 * Решту Диска користувача він не може ні прочитати, ні змінити, ні видалити.
 */
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_FOLDER = "Гараж Амедро";
const OAUTH_COOKIE = "g_oauth";
const now = () => Math.floor(Date.now() / 1000);

const DISCONNECTED = "Google Диск не подключён.";

export const googleConfigured = (env: Bindings): boolean =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.TOKEN_KEY);

const tokenKey = (env: Bindings): string => {
  if (!env.TOKEN_KEY) throw new ApiError(503, "Google пока не настроен на сервере.");
  return env.TOKEN_KEY;
};

type Connection = {
  user_id: string;
  google_email: string | null;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires: number;
  root_folder_id: string | null;
  gallery_folder_id: string | null;
  shots_folder_id: string | null;
  sheet_id: string | null;
  sheet_exported_at: number | null;
};

const getConnection = (db: D1Database, userId: string): Promise<Connection | null> =>
  db.prepare("SELECT * FROM google_connections WHERE user_id = ?").bind(userId).first<Connection>();

export const sheetUrl = (id: string): string => `https://docs.google.com/spreadsheets/d/${id}/edit`;

export async function driveStatus(db: D1Database, userId: string) {
  const conn = await getConnection(db, userId);
  return {
    connected: Boolean(conn),
    email: conn?.google_email ?? null,
    sheetUrl: conn?.sheet_id ? sheetUrl(conn.sheet_id) : null,
    sheetExportedAt: conn?.sheet_exported_at ?? null,
  };
}

async function accessToken(env: Bindings, userId: string): Promise<string> {
  const conn = await getConnection(env.DB, userId);
  if (!conn) throw new ApiError(409, DISCONNECTED, "drive_disconnected");
  return accessTokenFor(env, conn);
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
    throw new ApiError(409, "Доступ к Google Диску отозван. Подключи его заново.", "drive_disconnected");
  }
  if (!res.ok || !body.access_token) throw new ApiError(502, "Google сейчас не отвечает. Попробуй позже.");

  await env.DB.prepare("UPDATE google_connections SET access_token_enc = ?, access_expires = ? WHERE user_id = ?")
    .bind(await encryptToken(body.access_token, key, conn.user_id), now() + (body.expires_in ?? 3600), conn.user_id)
    .run();
  return body.access_token;
}

async function createFolder(token: string, name: string, parent?: string): Promise<string> {
  const res = await fetch(`${DRIVE_URL}?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parent ? [parent] : undefined }),
  });
  if (!res.ok) throw new ApiError(502, "Не получилось создать папку на Google Диске.");
  return (await res.json<{ id: string }>()).id;
}

const folderAlive = async (token: string, id: string | null): Promise<boolean> => {
  if (!id) return false;
  const res = await fetch(`${DRIVE_URL}/${encodeURIComponent(id)}?fields=trashed`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  return (await res.json<{ trashed?: boolean }>()).trashed !== true;
};

/** Папки: «Гараж Амедро» → «Галерея» і «Скриншоты». Якщо користувач їх видалив, створюємо заново. */
async function ensureFolders(env: Bindings, conn: Connection, token: string): Promise<{ gallery: string; shots: string; root: string }> {
  const rootOk = await folderAlive(token, conn.root_folder_id);
  const root = rootOk && conn.root_folder_id ? conn.root_folder_id : await createFolder(token, ROOT_FOLDER);
  const gallery =
    rootOk && (await folderAlive(token, conn.gallery_folder_id)) && conn.gallery_folder_id
      ? conn.gallery_folder_id
      : await createFolder(token, "Галерея", root);
  const shots =
    rootOk && (await folderAlive(token, conn.shots_folder_id)) && conn.shots_folder_id
      ? conn.shots_folder_id
      : await createFolder(token, "Скриншоты", root);
  await env.DB.prepare(
    "UPDATE google_connections SET root_folder_id = ?, gallery_folder_id = ?, shots_folder_id = ? WHERE user_id = ?",
  )
    .bind(root, gallery, shots, conn.user_id)
    .run();
  conn.root_folder_id = root;
  conn.gallery_folder_id = gallery;
  conn.shots_folder_id = shots;
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

const redirectUri = (env: Bindings): string => `${env.APP_URL}/api/google/callback`;

type OAuthState = { state: string; verifier: string; mode: "login" | "drive"; uid: string | null };

const beginOAuth = async (c: Context<AppEnv>, mode: OAuthState["mode"], uid: string | null, scope: string, extra: Record<string, string>) => {
  if (!googleConfigured(c.env)) throw new ApiError(503, "Google пока не настроен на сервере.");
  const state = randomToken(24);
  const verifier = randomToken(48);
  const payload: OAuthState = { state, verifier, mode, uid };
  setCookie(c, OAUTH_COOKIE, btoa(JSON.stringify(payload)), {
    path: "/api/google",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: 600,
  });
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(c.env),
    response_type: "code",
    scope,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    ...extra,
  }).toString();
  return c.redirect(url.toString(), 302);
};

const decodeIdToken = (idToken: string): Record<string, unknown> => {
  // Токен отримано напряму від Google по TLS, тому окрема перевірка підпису не потрібна (OIDC Core 3.1.3.7).
  const part = idToken.split(".")[1] ?? "";
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(json, (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
};

async function finishLogin(c: Context<AppEnv>, claims: Record<string, unknown>): Promise<Response> {
  const sub = String(claims.sub ?? "");
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const verified = claims.email_verified === true;
  const name = typeof claims.name === "string" ? claims.name.slice(0, 80) : "";
  if (!sub || !email || !verified) return c.redirect("/?google=unverified");

  const db = c.env.DB;

  // Користувач уже в акаунті: прив'язуємо Google до нього.
  const current = await loadUser(c);
  if (current) {
    const taken = await db.prepare("SELECT id FROM users WHERE google_sub = ? AND id <> ?").bind(sub, current.id).first();
    if (taken) return c.redirect("/?google=taken");
    await db.prepare("UPDATE users SET google_sub = ? WHERE id = ?").bind(sub, current.id).run();
    return c.redirect("/?google=linked");
  }

  const bySub = await db.prepare("SELECT id FROM users WHERE google_sub = ?").bind(sub).first<{ id: string }>();
  if (bySub) {
    await createSession(c, bySub.id);
    return c.redirect("/");
  }

  const byEmail = await db
    .prepare("SELECT u.id, g.google_email FROM users u LEFT JOIN google_connections g ON g.user_id = u.id WHERE u.email_key = ?")
    .bind(email)
    .first<{ id: string; google_email: string | null }>();
  if (byEmail) {
    /*
     * Пошту при реєстрації за паролем ми не підтверджуємо. Хтось міг заздалегідь зареєструвати
     * чужу адресу, тому справжній власник (Google це підтвердив) забирає акаунт: старий пароль
     * і всі сесії скасовуються, а чужий Диск відключається.
     */
    const statements = [
      db.prepare("UPDATE users SET google_sub = ?, password_hash = NULL WHERE id = ?").bind(sub, byEmail.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(byEmail.id),
    ];
    if (byEmail.google_email && byEmail.google_email.toLowerCase() !== email) {
      statements.push(db.prepare("DELETE FROM google_connections WHERE user_id = ?").bind(byEmail.id));
    }
    await db.batch(statements);
    await createSession(c, byEmail.id);
    return c.redirect("/?google=claimed");
  }

  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, email_key, name, google_sub, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, email, email, name, sub, now())
    .run();
  await createSession(c, id);
  return c.redirect("/");
}

async function finishDrive(
  c: Context<AppEnv>,
  uid: string | null,
  tokens: { refresh_token?: string; access_token?: string; expires_in?: number; scope?: string; id_token?: string },
): Promise<Response> {
  const user = await loadUser(c);
  if (!user || user.id !== uid) return c.redirect("/?drive=error");
  if (!tokens.scope?.split(" ").includes(DRIVE_SCOPE) || !tokens.access_token) return c.redirect("/?drive=scope");

  const key = tokenKey(c.env);
  const previous = await getConnection(c.env.DB, user.id);
  const refresh = tokens.refresh_token
    ? await encryptToken(tokens.refresh_token, key, user.id)
    : previous?.refresh_token_enc;
  if (!refresh) return c.redirect("/?drive=error");

  const claims = tokens.id_token ? decodeIdToken(tokens.id_token) : {};
  const email = typeof claims.email === "string" ? claims.email : null;

  await c.env.DB.prepare(
    `INSERT INTO google_connections (user_id, google_email, refresh_token_enc, access_token_enc, access_expires, connected_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (user_id) DO UPDATE SET google_email = ?2, refresh_token_enc = ?3, access_token_enc = ?4, access_expires = ?5`,
  )
    .bind(
      user.id,
      email,
      refresh,
      await encryptToken(tokens.access_token, key, user.id),
      now() + (tokens.expires_in ?? 3600),
      now(),
    )
    .run();

  const conn = await getConnection(c.env.DB, user.id);
  if (conn) await ensureFolders(c.env, conn, tokens.access_token);
  return c.redirect("/?drive=connected");
}

export const google = new Hono<AppEnv>();

google.get("/login", (c) =>
  beginOAuth(c, "login", null, "openid email profile", { prompt: "select_account" }),
);

google.get("/drive/connect", requireUser, (c) =>
  beginOAuth(c, "drive", c.get("user").id, `openid email ${DRIVE_SCOPE}`, {
    access_type: "offline",
    prompt: "consent",
    login_hint: c.get("user").email,
  }),
);

google.get("/callback", async (c) => {
  const raw = getCookie(c, OAUTH_COOKIE);
  deleteCookie(c, OAUTH_COOKIE, { path: "/api/google" });
  let saved: OAuthState | null = null;
  try {
    saved = raw ? (JSON.parse(atob(raw)) as OAuthState) : null;
  } catch {
    saved = null;
  }
  const state = c.req.query("state");
  if (!saved || !state || state !== saved.state) return c.redirect("/?google=state");

  const code = c.req.query("code");
  if (c.req.query("error") || !code) {
    return c.redirect(saved.mode === "drive" ? "/?drive=denied" : "/?google=denied");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: c.env.GOOGLE_CLIENT_SECRET ?? "",
      code,
      code_verifier: saved.verifier,
      redirect_uri: redirectUri(c.env),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return c.redirect(saved.mode === "drive" ? "/?drive=error" : "/?google=error");
  const tokens = await res.json<{
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>();

  if (saved.mode === "drive") return finishDrive(c, saved.uid, tokens);
  if (!tokens.id_token) return c.redirect("/?google=error");
  return finishLogin(c, decodeIdToken(tokens.id_token));
});

google.post("/drive/disconnect", requireUser, async (c) => {
  const user = c.get("user");
  await revokeGoogle(c.env, user.id).catch(() => undefined);
  await c.env.DB.prepare("DELETE FROM google_connections WHERE user_id = ?").bind(user.id).run();
  return c.json({ ok: true });
});

const NUMBER_FORMATS: Partial<Record<Column["format"], { type: string; pattern: string }>> = {
  money: { type: "NUMBER", pattern: "#,##0.00" },
  int: { type: "NUMBER", pattern: "#,##0" },
  dec1: { type: "NUMBER", pattern: "0.0" },
  liters: { type: "NUMBER", pattern: "#,##0.00" },
  date: { type: "DATE", pattern: "dd.mm.yyyy" },
};

const formatRequests = (sheet: Sheet, sheetId: number): unknown[] => {
  const requests: unknown[] = [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold",
      },
    },
  ];
  sheet.columns.forEach((column, i) => {
    const numberFormat = NUMBER_FORMATS[column.format];
    if (!numberFormat) return;
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: { userEnteredFormat: { numberFormat } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  });
  requests.push({
    autoResizeDimensions: {
      dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: sheet.columns.length },
    },
  });
  return requests;
};

const sheetsFetch = async (token: string, path: string, init?: RequestInit): Promise<Response> =>
  fetch(`${SHEETS_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

google.post("/sheet/export", requireUser, async (c) => {
  const user = c.get("user");
  await limitApi(c, `sheet:${user.id}`);
  const conn = await getConnection(c.env.DB, user.id);
  if (!conn) throw new ApiError(409, DISCONNECTED, "drive_disconnected");
  const token = await accessTokenFor(c.env, conn);

  const garage = await loadGarage(c.env.DB, user.id, user.demo);
  const sheets = buildSheets(garage, todayISO());

  // Таблиця могла бути видалена вручну: тоді створюємо нову.
  let spreadsheetId = conn.sheet_id;
  let tabIds = new Map<string, number>();
  if (spreadsheetId) {
    const meta = await sheetsFetch(token, `/${spreadsheetId}?fields=sheets.properties`);
    if (meta.ok) {
      const body = await meta.json<{ sheets: { properties: { sheetId: number; title: string } }[] }>();
      tabIds = new Map(body.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
    } else {
      spreadsheetId = null;
    }
  }

  if (!spreadsheetId) {
    const created = await sheetsFetch(token, "?fields=spreadsheetId,sheets.properties", {
      method: "POST",
      body: JSON.stringify({
        properties: { title: "Гараж Амедро: бэкап", locale: "ru_RU", timeZone: "Europe/Kyiv" },
        sheets: sheets.map((s) => ({
          properties: { title: s.title, gridProperties: { frozenRowCount: 1 } },
        })),
      }),
    });
    if (!created.ok) throw new ApiError(502, "Не получилось создать таблицу. Попробуй позже.");
    const body = await created.json<{
      spreadsheetId: string;
      sheets: { properties: { sheetId: number; title: string } }[];
    }>();
    spreadsheetId = body.spreadsheetId;
    tabIds = new Map(body.sheets.map((s) => [s.properties.title, s.properties.sheetId]));

    const folders = await ensureFolders(c.env, conn, token);
    await fetch(`${DRIVE_URL}/${spreadsheetId}?addParents=${folders.root}&removeParents=root&fields=id`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
  } else {
    // Лист могли перейменувати чи видалити: повертаємо ті, яких бракує.
    const missing = sheets.filter((s) => !tabIds.has(s.title));
    if (missing.length) {
      const added = await sheetsFetch(token, `/${spreadsheetId}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          requests: missing.map((s) => ({
            addSheet: { properties: { title: s.title, gridProperties: { frozenRowCount: 1 } } },
          })),
        }),
      });
      if (!added.ok) throw new ApiError(502, "Не получилось обновить таблицу. Попробуй позже.");
      const body = await added.json<{ replies: { addSheet: { properties: { sheetId: number; title: string } } }[] }>();
      for (const reply of body.replies) tabIds.set(reply.addSheet.properties.title, reply.addSheet.properties.sheetId);
    }
    const cleared = await sheetsFetch(token, `/${spreadsheetId}/values:batchClear`, {
      method: "POST",
      body: JSON.stringify({ ranges: sheets.map((s) => s.title) }),
    });
    if (!cleared.ok) throw new ApiError(502, "Не получилось обновить таблицу. Попробуй позже.");
  }

  // RAW і числа в JSON: таблиця не намагається нічого розбирати за своєю локаллю.
  const written = await sheetsFetch(token, `/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: sheets.map((s) => ({
        range: s.title,
        majorDimension: "ROWS",
        values: sheetValues(s).map((row) => row.map((cell) => cell ?? "")),
      })),
    }),
  });
  if (!written.ok) throw new ApiError(502, "Не получилось записать данные в таблицу. Попробуй позже.");

  const formatted = await sheetsFetch(token, `/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: sheets.flatMap((s) => {
        const id = tabIds.get(s.title);
        return id == null ? [] : formatRequests(s, id);
      }),
    }),
  });
  if (!formatted.ok) console.warn(JSON.stringify({ event: "sheet_format_failed", status: formatted.status }));

  const exportedAt = now();
  await c.env.DB.prepare("UPDATE google_connections SET sheet_id = ?, sheet_exported_at = ? WHERE user_id = ?")
    .bind(spreadsheetId, exportedAt, user.id)
    .run();
  return c.json({ url: sheetUrl(spreadsheetId), exportedAt });
});

google.post("/sheet/import", requireUser, async (c) => {
  const user = c.get("user");
  await limitApi(c, `sheet:${user.id}`);
  const conn = await getConnection(c.env.DB, user.id);
  if (!conn) throw new ApiError(409, DISCONNECTED, "drive_disconnected");
  if (!conn.sheet_id) throw new ApiError(404, "Таблицы пока нет. Сначала обнови её с сайта.");
  const token = await accessTokenFor(c.env, conn);

  const titles = Object.values(SHEET_TITLES);
  const query = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  for (const t of titles) query.append("ranges", t);

  const res = await sheetsFetch(token, `/${conn.sheet_id}/values:batchGet?${query}`);
  if (!res.ok) throw new ApiError(502, "Не получилось прочитать таблицу. Проверь, что она не удалена.");
  const body = await res.json<{ valueRanges?: { range: string; values?: unknown[][] }[] }>();

  const tabs: Record<string, unknown[][] | undefined> = {};
  for (const range of body.valueRanges ?? []) {
    const title = range.range.split("!")[0].replace(/^'|'$/g, "");
    tabs[title] = range.values;
  }
  const backup = sheetsToBackup(tabs);
  if (!backup) throw new ApiError(400, "В таблице нет листов бэкапа.");
  return c.json({ backup });
});

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

export const photos = new Hono<AppEnv>();
photos.use("*", requireUser);

photos.post("/", async (c) => {
  const user = c.get("user");
  await limitApi(c, `upload:${user.id}`);

  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > LIMITS.uploadBytes) throw new ApiError(413, "Файл слишком большой: максимум 25 МБ.");

  const form = await c.req.formData();
  const file = form.get("file");
  const id = String(form.get("id") ?? "");
  const carId = String(form.get("car") ?? "");
  const kind = form.get("kind") === "record" ? "record" : "gallery";
  const recordId = kind === "record" ? String(form.get("recordId") ?? "") : null;
  const width = Number(form.get("width")) || null;
  const height = Number(form.get("height")) || null;

  if (!(file instanceof File) || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || !carId) {
    throw new ApiError(400, "Некорректные данные.");
  }
  if (recordId !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(recordId)) throw new ApiError(400, "Некорректные данные.");
  if (file.size > LIMITS.uploadBytes) throw new ApiError(413, "Файл слишком большой: максимум 25 МБ.");
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new ApiError(415, "Можно загружать только фото: JPG, PNG, WebP, GIF или HEIC.");
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!looksLikeImage(head, file.type)) throw new ApiError(415, "Файл не похож на изображение.");

  const db = c.env.DB;
  const owned = await db.prepare("SELECT 1 FROM cars WHERE user_id = ? AND id = ?").bind(user.id, carId).first();
  if (!owned) throw new ApiError(404, "Машина не найдена.");
  const count = await db.prepare("SELECT COUNT(*) AS n FROM photos WHERE user_id = ?").bind(user.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= LIMITS.photos) throw new ApiError(413, "Достигнут лимит фото на аккаунт.");

  const conn = await getConnection(db, user.id);
  if (!conn) throw new ApiError(409, DISCONNECTED, "drive_disconnected");
  const token = await accessTokenFor(c.env, conn);

  const upload = async (folder: string): Promise<Response> => {
    const boundary = `garage${randomToken(12)}`;
    const name = safeFileName(file.name);
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`;
    const body = new Blob([head, file, `\r\n--${boundary}--\r\n`]);
    return fetch(`${UPLOAD_URL}?uploadType=multipart&fields=id,name,size`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
  };

  let folder = kind === "record" ? conn.shots_folder_id : conn.gallery_folder_id;
  if (!folder) {
    const f = await ensureFolders(c.env, conn, token);
    folder = kind === "record" ? f.shots : f.gallery;
  }
  let res = await upload(folder);
  if (res.status === 404) {
    // Папку видалили на Диску: відновлюємо і повторюємо один раз.
    const f = await ensureFolders(c.env, conn, token);
    res = await upload(kind === "record" ? f.shots : f.gallery);
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
  return c.json({ photo: photoFromRow(row) });
});

const imageHeaders = (mime: string): Headers =>
  new Headers({
    "Content-Type": mime,
    "Cache-Control": "private, max-age=604800, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": "inline",
  });

photos.get("/:id/:size{thumb|full}", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT drive_id, mime FROM photos WHERE user_id = ? AND id = ?")
    .bind(user.id, c.req.param("id"))
    .first<{ drive_id: string; mime: string }>();
  if (!row) throw new ApiError(404, "Фото не найдено.");

  const token = await accessToken(c.env, user.id);
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
    const token = await accessTokenFor(c.env, conn);
    await fetch(`${DRIVE_URL}/${encodeURIComponent(row.drive_id)}?fields=id`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    }).catch(() => undefined);
  }
  await c.env.DB.prepare("DELETE FROM photos WHERE user_id = ? AND id = ?").bind(user.id, c.req.param("id")).run();
  return c.json({ ok: true });
});
