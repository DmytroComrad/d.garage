import { Hono } from "hono";
import { todayISO } from "../../shared/format";
import { MESSAGES } from "../../shared/i18n";
import type { DateFormat, Lang } from "../../shared/prefs";
import { sheetExportSchema } from "../../shared/schema";
import {
  ALL_SHEET_TITLES,
  SHEET_DATE_PATTERNS,
  buildSheets,
  sheetValues,
  sheetsToBackup,
  type Column,
  type Sheet,
} from "../../shared/sheet";
import type { SheetExportResponse, SheetImportResponse } from "../../shared/types";
import { loadGarage } from "../data";
import { nbuToday, ratesFor } from "../fx";
import { limitApi, readJson } from "../guard";
import { requestLang } from "../messages";
import { requireUser } from "../session";
import { ApiError, type AppEnv, type Bindings } from "../types";
import { DRIVE_URL, driveFileState, ensureFolders, requireDrive, sheetUrl, type Connection } from "./connection";

const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const now = () => Math.floor(Date.now() / 1000);

const SHEET_LOCALES: Record<Lang, string> = { en: "en_US", uk: "uk_UA", ru: "ru_RU" };

const numberFormats = (dateFormat: DateFormat): Partial<Record<Column["format"], { type: string; pattern: string }>> => ({
  money: { type: "NUMBER", pattern: "#,##0.00" },
  int: { type: "NUMBER", pattern: "#,##0" },
  dec1: { type: "NUMBER", pattern: "0.0" },
  liters: { type: "NUMBER", pattern: "#,##0.00" },
  date: { type: "DATE", pattern: SHEET_DATE_PATTERNS[dateFormat] },
});

const formatRequests = (sheet: Sheet, sheetId: number, dateFormat: DateFormat): unknown[] => {
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
    const numberFormat = numberFormats(dateFormat)[column.format];
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

const sheetsFetch = (token: string, path: string, init?: RequestInit): Promise<Response> =>
  fetch(`${SHEETS_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

type TabList = { sheets: { properties: { sheetId: number; title: string } }[] };
const tabIdsOf = (body: TabList) => new Map(body.sheets.map((s) => [s.properties.title, s.properties.sheetId]));

/** Листи таблиці. null: таблицю видалили або вона в кошику. Тимчасова помилка Google — не видалення. */
async function openSpreadsheet(token: string, id: string): Promise<Map<string, number> | null> {
  if ((await driveFileState(token, id)) === "gone") return null;
  const res = await sheetsFetch(token, `/${id}?fields=sheets.properties`);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(502, "sheetsDown");
  return tabIdsOf(await res.json<TabList>());
}

async function createSpreadsheet(
  env: Bindings,
  conn: Connection,
  token: string,
  sheets: Sheet[],
  lang: Lang,
): Promise<{ id: string; tabs: Map<string, number> }> {
  const res = await sheetsFetch(token, "?fields=spreadsheetId,sheets.properties", {
    method: "POST",
    body: JSON.stringify({
      properties: { title: MESSAGES[lang].sheet.file, locale: SHEET_LOCALES[lang] },
      sheets: sheets.map((s) => ({ properties: { title: s.title, gridProperties: { frozenRowCount: 1 } } })),
    }),
  });
  if (!res.ok) throw new ApiError(502, "sheetCreateFailed");
  const body = await res.json<TabList & { spreadsheetId: string }>();

  const folders = await ensureFolders(env, conn, token, lang);
  await fetch(`${DRIVE_URL}/${body.spreadsheetId}?addParents=${folders.root}&removeParents=root&fields=id`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
  return { id: body.spreadsheetId, tabs: tabIdsOf(body) };
}

/**
 * Лист могли перейменувати чи видалити: повертаємо ті, яких бракує, і чистимо решту.
 * Листи бекапу іншою мовою (людина змінила мову сайту) прибираємо, щоб у таблиці не лишалось застарілих копій.
 */
async function prepareSpreadsheet(token: string, id: string, tabs: Map<string, number>, sheets: Sheet[]): Promise<void> {
  const failed = "sheetUpdateFailed";
  const current = new Set(sheets.map((s) => s.title));
  const missing = sheets.filter((s) => !tabs.has(s.title));
  const stale = [...tabs].filter(([title]) => ALL_SHEET_TITLES.has(title) && !current.has(title));
  if (missing.length || stale.length) {
    // Спершу додаємо, потім видаляємо: у таблиці завжди має лишатися хоч один лист.
    const changed = await sheetsFetch(token, `/${id}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          ...missing.map((s) => ({
            addSheet: { properties: { title: s.title, gridProperties: { frozenRowCount: 1 } } },
          })),
          ...stale.map(([, sheetId]) => ({ deleteSheet: { sheetId } })),
        ],
      }),
    });
    if (!changed.ok) throw new ApiError(502, failed);
    const body = await changed.json<{
      replies: { addSheet?: { properties: { sheetId: number; title: string } } }[];
    }>();
    for (const reply of body.replies ?? []) {
      if (reply.addSheet) tabs.set(reply.addSheet.properties.title, reply.addSheet.properties.sheetId);
    }
    for (const [title] of stale) tabs.delete(title);
  }
  const cleared = await sheetsFetch(token, `/${id}/values:batchClear`, {
    method: "POST",
    body: JSON.stringify({ ranges: sheets.map((s) => s.title) }),
  });
  if (!cleared.ok) throw new ApiError(502, failed);
}

async function writeSpreadsheet(
  token: string,
  id: string,
  tabs: Map<string, number>,
  sheets: Sheet[],
  lang: Lang,
  dateFormat: DateFormat,
): Promise<void> {
  // RAW і числа в JSON: таблиця не намагається нічого розбирати за своєю локаллю.
  const written = await sheetsFetch(token, `/${id}/values:batchUpdate`, {
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
  if (!written.ok) throw new ApiError(502, "sheetWriteFailed");

  const formatted = await sheetsFetch(token, `/${id}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        // Назва файлу й локаль — мовою, якою його оновили востаннє.
        {
          updateSpreadsheetProperties: {
            properties: { title: MESSAGES[lang].sheet.file, locale: SHEET_LOCALES[lang] },
            fields: "title,locale",
          },
        },
        ...sheets.flatMap((s) => {
          const tab = tabs.get(s.title);
          return tab == null ? [] : formatRequests(s, tab, dateFormat);
        }),
      ],
    }),
  });
  if (!formatted.ok) console.warn(JSON.stringify({ event: "sheet_format_failed", status: formatted.status }));
}

export const sheets = new Hono<AppEnv>();

sheets.post("/export", requireUser, async (c) => {
  const user = c.get("user");
  await limitApi(c, `sheet:${user.id}`);
  const { dateFormat, currency } = await readJson(c, sheetExportSchema);
  const lang = requestLang(c);
  const { conn, token } = await requireDrive(c.env, user.id);

  const garage = await loadGarage(c.env.DB, user.id, user.demo);
  const today = todayISO();
  // Курси лише ті, що вже є в базі: НБУ тут не чекаємо, бо цей запит і так ходить до Google.
  const { rates } = await ratesFor(c.env, garage, nbuToday(), { fill: false });
  const content = buildSheets(garage, today, lang, { currency, rates });

  const existing = conn.sheet_id ? await openSpreadsheet(token, conn.sheet_id) : null;
  let spreadsheetId: string;
  let tabs: Map<string, number>;
  if (conn.sheet_id && existing) {
    spreadsheetId = conn.sheet_id;
    tabs = existing;
    await prepareSpreadsheet(token, spreadsheetId, tabs, content);
  } else {
    ({ id: spreadsheetId, tabs } = await createSpreadsheet(c.env, conn, token, content, lang));
  }
  await writeSpreadsheet(token, spreadsheetId, tabs, content, lang, dateFormat);

  const exportedAt = now();
  await c.env.DB.prepare("UPDATE google_connections SET sheet_id = ?, sheet_exported_at = ? WHERE user_id = ?")
    .bind(spreadsheetId, exportedAt, user.id)
    .run();
  return c.json({ url: sheetUrl(spreadsheetId), exportedAt } satisfies SheetExportResponse);
});

sheets.post("/import", requireUser, async (c) => {
  const user = c.get("user");
  await limitApi(c, `sheet:${user.id}`);
  const { conn, token } = await requireDrive(c.env, user.id);
  if (!conn.sheet_id) throw new ApiError(404, "noSheet");

  const tabs = await openSpreadsheet(token, conn.sheet_id);
  if (!tabs) throw new ApiError(404, "sheetDeleted");

  // Лише наявні листи: один запит на всі разом падає, якщо хоч один перейменували чи видалили.
  const titles = [...tabs.keys()].filter((t) => ALL_SHEET_TITLES.has(t));
  if (!titles.length) throw new ApiError(400, "noBackupTabs");
  const query = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  for (const t of titles) query.append("ranges", t);

  const res = await sheetsFetch(token, `/${conn.sheet_id}/values:batchGet?${query}`);
  if (!res.ok) throw new ApiError(502, "sheetReadFailed");
  const body = await res.json<{ valueRanges?: { range: string; values?: unknown[][] }[] }>();

  const values: Record<string, unknown[][] | undefined> = {};
  for (const range of body.valueRanges ?? []) {
    values[range.range.split("!")[0].replace(/^'|'$/g, "")] = range.values;
  }
  const backup = sheetsToBackup(values);
  if (!backup) throw new ApiError(400, "noBackupTabs");
  return c.json({ backup } satisfies SheetImportResponse);
});
