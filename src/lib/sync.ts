import { LIMITS } from "../../shared/constants";
import { retargetOp } from "../../shared/ops";
import type { Op, OpsResponse } from "../../shared/types";
import { HttpError } from "./api";

export type DrainIO = {
  queue: () => Op[];
  setQueue: (queue: Op[]) => void;
  send: (ops: Op[]) => Promise<OpsResponse>;
  /** Сервер об'єднав нову машину з наявною: id змінився. */
  onRemap: (aliases: Map<string, string>) => void;
  notify: (text: string) => void;
};

export type DrainResult = {
  /** done: черга порожня. retry: повторити пізніше. unauthorized: сесія закінчилась. */
  outcome: "done" | "retry" | "unauthorized";
  /** Локальні дані могли розійтися із сервером: їх треба перечитати повністю. */
  stale: boolean;
};

/**
 * Відправляє чергу пачками, поки вона не спорожніє.
 * Збій мережі чи сервера лишає чергу цілою. Якщо сервер не приймає пачку, винний запис шукається
 * поштучно, щоб не втратити решту, а сам він відкидається: інакше черга застрягла б назавжди.
 */
export async function drainQueue(io: DrainIO): Promise<DrainResult> {
  let stale = false;
  let chunkSize: number = LIMITS.opsPerRequest;

  while (io.queue().length) {
    const chunk = io.queue().slice(0, chunkSize);
    try {
      const { rejected, remapped } = await io.send(chunk);
      const aliases = new Map(Object.entries(remapped ?? {}));
      if (rejected.length) {
        stale = true;
        io.notify("Часть изменений не сохранилась: проверь записи.");
      }
      if (aliases.size) stale = true;
      // Операції могли додатись, поки йшов запит: прибираємо лише відправлені.
      io.setQueue(
        io
          .queue()
          .slice(chunk.length)
          .map((op) => (aliases.size ? retargetOp(op, aliases) : op)),
      );
      if (aliases.size) io.onRemap(aliases);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) return { outcome: "unauthorized", stale };
      if (!(err instanceof HttpError) || err.status >= 500 || err.status === 429) return { outcome: "retry", stale };
      if (chunk.length > 1) {
        chunkSize = 1;
        continue;
      }
      io.setQueue(io.queue().slice(1));
      io.notify(err.message);
      stale = true;
    }
  }
  return { outcome: "done", stale };
}

/**
 * Яка черга належить користувачу, що щойно прийшов із сервера.
 * Чужа черга (на пристрої лишились зміни іншого акаунта) не має потрапити в цей гараж,
 * а відкладена після закінчення сесії повертається лише тому, хто її зробив.
 */
export function reconcileQueue(args: {
  localUserId: string | null;
  serverUserId: string;
  queue: Op[];
  pending: { userId: string; queue: Op[] } | null;
}): Op[] {
  const own = args.localUserId && args.localUserId !== args.serverUserId ? [] : args.queue;
  return args.pending?.userId === args.serverUserId ? [...args.pending.queue, ...own] : own;
}
