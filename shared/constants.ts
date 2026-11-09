import { messages, type Messages } from "./i18n";
import type { ItemKind } from "./types";

/**
 * Категорії зберігаються в записах саме цими рядками: так було з першої версії, і бекапи їх містять.
 * Показуємо переклад за ключем, а невідому категорію (з чужого бекапу) — як є.
 */
export const CATEGORIES = [
  { id: "Ремонт", key: "repair" },
  { id: "ТО / расходники", key: "maintenance" },
  { id: "Шины / диски", key: "tires" },
  { id: "Запчасти / покупки", key: "parts" },
  { id: "Мойка / уход", key: "care" },
  { id: "Документы / страховка", key: "documents" },
  { id: "Тюнинг", key: "tuning" },
  { id: "Штрафы", key: "fines" },
  { id: "Другое", key: "other" },
] as const;

export const DEFAULT_CATEGORY = "Ремонт";
export const OTHER_CATEGORY = "Другое";
export const WISH_CATEGORY = "Запчасти / покупки";

export const categoryLabel = (cat: string, m: Messages = messages()): string => {
  const known = CATEGORIES.find((c) => c.id === cat);
  return known ? m.categories[known.key] : cat;
};

export const ITEM_KINDS: ItemKind[] = ["parts", "labor", "extra"];

export const itemKindLabel = (kind: ItemKind, m: Messages = messages()): string => m.itemKinds[kind].label;

/** Єдине джерело меж: їх використовують схеми сервера, імпорт і форми. */
export const LIMITS = {
  cars: 50,
  service: 10000,
  fuel: 10000,
  reminders: 2000,
  wishes: 2000,
  manuals: 500,
  contacts: 2000,
  photos: 5000,
  itemsPerRecord: 60,
  whatLength: 1000,
  noteLength: 1000,
  placeLength: 200,
  itemNameLength: 120,
  carNameLength: 80,
  plateLength: 16,
  carAboutLength: 1000,
  minCarYear: 1900,
  minEngine: 0.1,
  maxEngine: 20,
  personNameLength: 80,
  titleLength: 200,
  linksPerWish: 10,
  urlLength: 2000,
  contactNameLength: 120,
  contactRoleLength: 200,
  phoneLength: 40,
  emailLength: 254,
  categoryLength: 80,
  maxOdo: 100_000_000,
  maxLiters: 100_000,
  maxSum: 10_000_000_000,
  // Безкоштовний план Workers дає 50 звернень до бази на запит: стільки вистачить і на запасний шлях по одній.
  opsPerRequest: 40,
  uploadBytes: 25 * 1024 * 1024,
} as const;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"] as const;

export const BACKUP_APP = "d-garage";
/** Так бекапи підписувались до перейменування: їх теж приймаємо. */
export const LEGACY_BACKUP_APPS = ["garage-amedro"] as const;
