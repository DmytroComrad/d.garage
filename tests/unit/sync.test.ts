import { describe, expect, it } from "vitest";
import type { Op, OpsResponse } from "../../shared/types";
import { HttpError, NetworkError } from "../../src/lib/api";
import { createCache, type KeyValueStore } from "../../src/lib/cache";
import { drainQueue, reconcileQueue, type DrainIO } from "../../src/lib/sync";

const carOp = (id: string): Op => ({ type: "car.put", data: { id, name: id } });
const fuelOp = (id: string, car: string): Op => ({
  type: "fuel.put",
  data: { id, car, date: "2026-08-21", odo: 1000, liters: 30, sum: 2000, station: "", full: true, note: "" },
});
const ok: OpsResponse = { rejected: [], remapped: {} };

type Harness = DrainIO & { sent: Op[][]; messages: string[]; state: { queue: Op[] }; remaps: Map<string, string>[] };

const harness = (queue: Op[], send: (ops: Op[]) => Promise<OpsResponse>): Harness => {
  const state = { queue };
  const sent: Op[][] = [];
  const messages: string[] = [];
  const remaps: Map<string, string>[] = [];
  return {
    state,
    sent,
    messages,
    remaps,
    queue: () => state.queue,
    setQueue: (next) => {
      state.queue = next;
    },
    send: (ops) => {
      sent.push(ops);
      return send(ops);
    },
    onRemap: (aliases) => {
      remaps.push(aliases);
    },
    notify: (text) => {
      messages.push(text);
    },
  };
};

describe("черга синхронізації", () => {
  it("відправляє все й лишає чергу порожньою", async () => {
    const io = harness([carOp("a"), carOp("b")], async () => ok);
    expect(await drainQueue(io)).toEqual({ outcome: "done", stale: false });
    expect(io.state.queue).toEqual([]);
    expect(io.sent).toHaveLength(1);
  });

  it("велика черга йде пачками, порядок зберігається", async () => {
    const ops = Array.from({ length: 95 }, (_, i) => carOp(`c${i}`));
    const io = harness(ops, async () => ok);
    await drainQueue(io);
    expect(io.sent.map((c) => c.length)).toEqual([40, 40, 15]);
    expect(io.sent.flat()).toEqual(ops);
  });

  it("операції, додані під час запиту, не губляться", async () => {
    const late = carOp("late");
    const io = harness([carOp("a")], async () => {
      if (!io.state.queue.includes(late)) io.state.queue = [...io.state.queue, late];
      return ok;
    });
    await drainQueue(io);
    expect(io.sent.flat()).toContainEqual(late);
    expect(io.state.queue).toEqual([]);
  });

  it("без мережі черга лишається цілою", async () => {
    const ops = [carOp("a"), carOp("b")];
    const io = harness(ops, async () => {
      throw new NetworkError("offline");
    });
    expect(await drainQueue(io)).toEqual({ outcome: "retry", stale: false });
    expect(io.state.queue).toEqual(ops);
  });

  it.each([500, 503, 429])("статус %i повторюється пізніше, а не губить дані", async (status) => {
    const ops = [carOp("a")];
    const io = harness(ops, async () => {
      throw new HttpError(status, "later");
    });
    expect((await drainQueue(io)).outcome).toBe("retry");
    expect(io.state.queue).toEqual(ops);
  });

  it("закінчення сесії лишає чергу цілою", async () => {
    const ops = [carOp("a")];
    const io = harness(ops, async () => {
      throw new HttpError(401, "auth");
    });
    expect((await drainQueue(io)).outcome).toBe("unauthorized");
    expect(io.state.queue).toEqual(ops);
  });

  it("поганий запис шукається поштучно: решта пачки зберігається", async () => {
    const bad = carOp("bad");
    const good = [carOp("a"), carOp("b")];
    const stored: Op[] = [];
    const io = harness([good[0], bad, good[1]], async (ops) => {
      if (ops.includes(bad)) throw new HttpError(400, "Некорректные данные.");
      stored.push(...ops);
      return ok;
    });
    expect(await drainQueue(io)).toEqual({ outcome: "done", stale: true });
    expect(stored).toEqual(good);
    expect(io.state.queue).toEqual([]);
    expect(io.messages).toEqual(["Некорректные данные."]);
  });

  it("відхилені базою записи позначають дані застарілими", async () => {
    const io = harness([carOp("a")], async () => ({ rejected: [0], remapped: {} }));
    expect(await drainQueue(io)).toEqual({ outcome: "done", stale: true });
    expect(io.messages).toHaveLength(1);
  });

  it("об'єднана машина: записи в черзі переходять на її справжній id", async () => {
    const ops = Array.from({ length: 41 }, (_, i) => (i === 0 ? carOp("dup") : fuelOp(`f${i}`, "dup")));
    const io = harness(ops, async (chunk) =>
      chunk.includes(ops[0]) ? { rejected: [], remapped: { dup: "real" } } : ok,
    );
    expect((await drainQueue(io)).stale).toBe(true);
    const last = io.sent[1][0];
    expect(last.type === "fuel.put" && last.data.car).toBe("real");
    expect(io.remaps[0].get("dup")).toBe("real");
  });
});

describe("чия черга", () => {
  const queue = [carOp("mine")];
  const pending = { userId: "u1", queue: [carOp("pending")] };

  it("свою чергу лишає", () => {
    expect(reconcileQueue({ localUserId: "u1", serverUserId: "u1", queue, pending: null })).toEqual(queue);
  });

  it("чужа черга на пристрої не потрапляє в цей гараж", () => {
    expect(reconcileQueue({ localUserId: "u1", serverUserId: "u2", queue, pending: null })).toEqual([]);
  });

  it("відкладена повертається тому, хто її зробив", () => {
    expect(reconcileQueue({ localUserId: null, serverUserId: "u1", queue: [], pending })).toEqual(pending.queue);
  });

  it("відкладена чужа відкидається", () => {
    expect(reconcileQueue({ localUserId: null, serverUserId: "u2", queue: [], pending })).toEqual([]);
  });

  it("відкладена йде раніше за нові зміни", () => {
    expect(reconcileQueue({ localUserId: "u1", serverUserId: "u1", queue, pending })).toEqual([...pending.queue, ...queue]);
  });
});

describe("кеш на пристрої", () => {
  const memory = (initial: Record<string, string> = {}) => {
    const items = new Map(Object.entries(initial));
    const store: KeyValueStore = {
      getItem: (k) => items.get(k) ?? null,
      setItem: (k, v) => void items.set(k, v),
      removeItem: (k) => void items.delete(k),
    };
    return { items, store };
  };
  const full = {
    user: { id: "u1", email: "a@b.c", name: "", hasPassword: true, hasGoogle: false },
    data: { cars: [], service: [], fuel: [], reminders: [], photos: [], demo: false },
    drive: { connected: false, email: null, sheetUrl: null, sheetExportedAt: null },
    queue: [],
    etag: null,
  };

  it("зберігає і читає стан", () => {
    const { store } = memory();
    const cache = createCache(() => store);
    expect(cache.write(full)).toBe(true);
    expect(cache.read()).toEqual(full);
  });

  it("стан не тієї форми відкидається, а не ламає застосунок", () => {
    const { store } = memory({ "garage-amedro-v1": JSON.stringify({ user: { id: "u1" }, queue: [] }) });
    expect(createCache(() => store).read()).toBeNull();
    const broken = memory({ "garage-amedro-v1": "{обрізано" });
    expect(createCache(() => broken.store).read()).toBeNull();
  });

  it("відкладена черга живе окремо й переживає очищення кешу", () => {
    const { store } = memory();
    const cache = createCache(() => store);
    cache.write(full);
    cache.writePending({ userId: "u1", queue: [carOp("a")] });
    cache.clear();
    expect(cache.read()).toBeNull();
    expect(cache.readPending()?.queue).toHaveLength(1);
    cache.clearPending();
    expect(cache.readPending()).toBeNull();
  });

  it("недоступне сховище не кидає винятків", () => {
    const cache = createCache(() => {
      throw new Error("denied");
    });
    expect(cache.write(full)).toBe(false);
    expect(cache.read()).toBeNull();
    expect(() => cache.clear()).not.toThrow();
  });
});
