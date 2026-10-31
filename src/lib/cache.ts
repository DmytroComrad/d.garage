import type { DriveStatus, GarageData, Op, User } from "../../shared/types";

const CACHE_KEY = "garage-amedro-v1";
const PENDING_KEY = "garage-amedro-pending-v1";

/** Копія на пристрої: щоб відкривалось миттєво і працювало без мережі. Правда живе на сервері. */
export type CachedState = {
  user: User;
  data: GarageData;
  drive: DriveStatus;
  queue: Op[];
  etag: string | null;
};

/** Зміни, які не встигли піти на сервер до кінця сесії. Самі дані на пристрої після цього не лишаються. */
export type PendingQueue = { userId: string; queue: Op[] };

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const isCachedState = (v: unknown): v is CachedState => {
  if (!isObject(v) || !isObject(v.user) || typeof v.user.id !== "string" || !isObject(v.data) || !Array.isArray(v.queue)) {
    return false;
  }
  const { cars, service, fuel, reminders, photos } = v.data;
  return [cars, service, fuel, reminders, photos].every(Array.isArray);
};

const isPendingQueue = (v: unknown): v is PendingQueue =>
  isObject(v) && typeof v.userId === "string" && Array.isArray(v.queue);

/** localStorage може бути недоступний або переповнений, тому жоден виклик тут не кидає винятків. */
export function createCache(storage: () => KeyValueStore) {
  const read = <T>(key: string, guard: (v: unknown) => v is T): T | null => {
    try {
      const raw = storage().getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return guard(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: unknown): boolean => {
    try {
      storage().setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };
  const remove = (key: string): void => {
    try {
      storage().removeItem(key);
    } catch {
      // Нічого стирати.
    }
  };

  return {
    read: () => read(CACHE_KEY, isCachedState),
    write: (value: CachedState) => write(CACHE_KEY, value),
    clear: () => remove(CACHE_KEY),
    readPending: () => read(PENDING_KEY, isPendingQueue),
    writePending: (value: PendingQueue) => write(PENDING_KEY, value),
    clearPending: () => remove(PENDING_KEY),
  };
}
