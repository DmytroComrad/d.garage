import { messages } from "../../shared/i18n";
import { prefs } from "../../shared/prefs";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** Мережа недоступна: на відміну від HttpError, сервер сюди не дійшов. */
export class NetworkError extends Error {}

export const errorText = (err: unknown): string =>
  err instanceof HttpError ? err.message : messages().common.noConnection;

const parse = async <T>(res: Response): Promise<T> => {
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (!res.ok) {
    throw new HttpError(res.status, body?.error ?? messages().common.somethingWrong, body?.code);
  }
  return body as T;
};

/** Мова інтерфейсу йде з кожним запитом: нею сервер пише помилки, листи й назви на Google Диску. */
const request = async (path: string, init: RequestInit): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set("X-Lang", prefs().lang);
  try {
    return await fetch(path, { credentials: "same-origin", ...init, headers });
  } catch {
    throw new NetworkError(messages().common.noServer);
  }
};

const send = async <T>(path: string, init: RequestInit): Promise<T> => parse<T>(await request(path, init));

export const getJson = <T>(path: string): Promise<T> => send<T>(path, {});

export type Conditional<T> = { changed: false } | { changed: true; body: T; etag: string | null };

/** GET із перевіркою версії: якщо дані на сервері ті самі, тіло не передається. */
export const getIfChanged = async <T>(path: string, etag: string | null): Promise<Conditional<T>> => {
  const res = await request(path, etag ? { headers: { "If-None-Match": etag } } : {});
  if (res.status === 304) return { changed: false };
  const newEtag = res.headers.get("etag");
  return { changed: true, body: await parse<T>(res), etag: newEtag };
};

export const postJson = <T>(path: string, body: unknown = {}): Promise<T> =>
  send<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const postForm = <T>(path: string, form: FormData): Promise<T> => send<T>(path, { method: "POST", body: form });

export const del = <T>(path: string): Promise<T> => send<T>(path, { method: "DELETE" });
