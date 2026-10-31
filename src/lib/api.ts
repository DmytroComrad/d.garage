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

const parse = async <T>(res: Response): Promise<T> => {
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (!res.ok) {
    throw new HttpError(res.status, body?.error ?? "Что-то пошло не так. Попробуй ещё раз.", body?.code);
  }
  return body as T;
};

const send = async <T>(path: string, init: RequestInit): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new NetworkError("Нет связи с сервером.");
  }
  return parse<T>(res);
};

export const getJson = <T>(path: string): Promise<T> => send<T>(path, {});

export const postJson = <T>(path: string, body: unknown = {}): Promise<T> =>
  send<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const postForm = <T>(path: string, form: FormData): Promise<T> => send<T>(path, { method: "POST", body: form });

export const del = <T>(path: string): Promise<T> => send<T>(path, { method: "DELETE" });
