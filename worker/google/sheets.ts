import { Hono } from "hono";
import { todayISO } from "../../shared/format";
import { SHEET_TITLES, buildSheets, sheetValues, sheetsToBackup, type Column, type Sheet } from "../../shared/sheet";
import type { SheetExportResponse, SheetImportResponse } from "../../shared/types";
import { loadGarage } from "../data";
import { limitApi } from "../guard";
import { requireUser } from "../session";
import { ApiError, type AppEnv, type Bindings } from "../types";
import { DRIVE_URL, driveFileState, ensureFolders, requireDrive, sheetUrl, type Connection } from "./connection";

const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const now = () => Math.floor(Date.now() / 1000);

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
  if (!res.ok) throw new ApiError(502, "Google Таблицы сейчас не отвечают. Попробуй позже.");
  return tabIdsOf(await res.json<TabList>());
}

async function createSpreadsheet(
  env: Bindings,
  conn: Connection,
  token: string,
  sheets: Sheet[],
): Promise<{ id: string; tabs: Map<string, number> }> {
  const res = await sheetsFetch(token, "?fields=spreadsheetId,sheets.properties", {
    method: "POST",
    body: JSON.stringify({
      properties: { title: "Гараж Амедро: бэкап", locale: "ru_RU" },
      sheets: sheets.map((s) => ({ properties: { title: s.title, gridProperties: { frozenRowCount: 1 } } })),
    }),
  });
  if (!res.ok) throw new ApiError(502, "Не получилось создать таблицу. Попробуй позже.");
  const body = await res.json<TabList & { spreadsheetId: string }>();

  const folders = await ensureFolders(env, conn, token);
  await fetch(`${DRIVE_URL}/${body.spreadsheetId}?addParents=${folders.root}&removeParents=root&fields=id`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
  return { id: body.spreadsheetId, tabs: tabIdsOf(body) };
}

/** Лист могли перейменувати чи видалити: повертаємо ті, яких бракує, і чистимо решту. */
async function prepareSpreadsheet(token: string, id: string, tabs: Map<string, number>, sheets: Sheet[]): Promise<void> {
  const failed = "Не получилось обновить таблицу. Попробуй позже.";
  const missing = sheets.filter((s) => !tabs.has(s.title));
  if (missing.length) {
    const added = await sheetsFetch(token, `/${id}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: missing.map((s) => ({
          addSheet: { properties: { title: s.title, gridProperties: { frozenRowCount: 1 } } },
        })),
      }),
    });
    if (!added.ok) throw new ApiError(502, failed);
    const body = await added.json<{ replies: { addSheet: { properties: { sheetId: number; title: string } } }[] }>();
    for (const reply of body.replies) tabs.set(reply.addSheet.properties.title, reply.addSheet.properties.sheetId);
  }
  const cleared = await sheetsFetch(token, `/${id}/values:batchClear`, {
    method: "POST",
    body: JSON.stringify({ ranges: sheets.map((s) => s.title) }),
  });
  if (!cleared.ok) throw new ApiError(502, failed);
}

async function writeSpreadsheet(token: string, id: string, tabs: Map<string, number>, sheets: Sheet[]): Promise<void> {
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
  if (!written.ok) throw new ApiError(502, "Не получилось записать данные в таблицу. Попробуй позже.");

  const formatted = await sheetsFetch(token, `/${id}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: sheets.flatMap((s) => {
        const tab = tabs.get(s.title);
        return tab == null ? [] : formatRequests(s, tab);
      }),
    }),
  });
  if (!formatted.ok) console.warn(JSON.stringify({ event: "sheet_format_failed", status: formatted.status }));
}

export const sheets = new Hono<AppEnv>();

sheets.post("/export", requireUser, async (c) => {
  const user = c.get("user");
  await limitApi(c, `sheet:${user.id}`);
  const { conn, token } = await requireDrive(c.env, user.id);

  const garage = await loadGarage(c.env.DB, user.id, user.demo);
  const content = buildSheets(garage, todayISO());

  const existing = conn.sheet_id ? await openSpreadsheet(token, conn.sheet_id) : null;
  let spreadsheetId: string;
  let tabs: Map<string, number>;
  if (conn.sheet_id && existing) {
    spreadsheetId = conn.sheet_id;
    tabs = existing;
    await prepareSpreadsheet(token, spreadsheetId, tabs, content);
  } else {
    ({ id: spreadsheetId, tabs } = await createSpreadsheet(c.env, conn, token, content));
  }
  await writeSpreadsheet(token, spreadsheetId, tabs, content);

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
  if (!conn.sheet_id) throw new ApiError(404, "Таблицы пока нет. Сначала обнови её с сайта.");

  const tabs = await openSpreadsheet(token, conn.sheet_id);
  if (!tabs) throw new ApiError(404, "Таблица удалена. Создай новую кнопкой выше.");

  // Лише наявні листи: один запит на всі разом падає, якщо хоч один перейменували чи видалили.
  const titles = Object.values(SHEET_TITLES).filter((t) => tabs.has(t));
  if (!titles.length) throw new ApiError(400, "В таблице нет листов бэкапа.");
  const query = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  for (const t of titles) query.append("ranges", t);

  const res = await sheetsFetch(token, `/${conn.sheet_id}/values:batchGet?${query}`);
  if (!res.ok) throw new ApiError(502, "Не получилось прочитать таблицу. Попробуй позже.");
  const body = await res.json<{ valueRanges?: { range: string; values?: unknown[][] }[] }>();

  const values: Record<string, unknown[][] | undefined> = {};
  for (const range of body.valueRanges ?? []) {
    values[range.range.split("!")[0].replace(/^'|'$/g, "")] = range.values;
  }
  const backup = sheetsToBackup(values);
  if (!backup) throw new ApiError(400, "В таблице нет листов бэкапа.");
  return c.json({ backup } satisfies SheetImportResponse);
});
