import type { Context } from "hono";
import { z } from "zod";
import { ApiError, type AppEnv } from "./types";

const LIMIT_MESSAGE = "Слишком много попыток. Подожди минуту и попробуй снова.";

export const clientIp = (c: Context<AppEnv>): string => c.req.header("cf-connecting-ip") ?? "local";

export async function limitAuth(c: Context<AppEnv>, key: string): Promise<void> {
  const { success } = await c.env.RL_AUTH.limit({ key });
  if (!success) throw new ApiError(429, LIMIT_MESSAGE);
}

export async function limitApi(c: Context<AppEnv>, key: string): Promise<void> {
  const { success } = await c.env.RL_API.limit({ key });
  if (!success) throw new ApiError(429, LIMIT_MESSAGE);
}

/** Тіло JSON із жорсткою межею розміру, щоб не читати в пам'ять що завгодно. */
export async function readJson<T extends z.ZodType>(
  c: Context<AppEnv>,
  schema: T,
  maxBytes = 64 * 1024,
): Promise<z.output<T>> {
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > maxBytes) throw new ApiError(413, "Слишком большой запрос.");
  const text = await c.req.text();
  if (text.length > maxBytes) throw new ApiError(413, "Слишком большой запрос.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError(400, "Не получилось прочитать запрос.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "Некорректные данные.");
  return parsed.data;
}

export async function verifyTurnstile(c: Context<AppEnv>, token: string | null | undefined): Promise<void> {
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret || !c.env.TURNSTILE_SITE_KEY) return;
  if (!token) throw new ApiError(400, "Подтверди, что ты не робот.");
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token, remoteip: clientIp(c) }),
  });
  const result = await res.json<{ success?: boolean }>().catch(() => ({ success: false }));
  if (result.success !== true) throw new ApiError(400, "Проверка на робота не прошла. Попробуй ещё раз.");
}
