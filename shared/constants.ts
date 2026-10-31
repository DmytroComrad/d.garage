import type { ItemKind } from "./types";

export const CATEGORIES = [
  "Ремонт",
  "ТО / расходники",
  "Шины / диски",
  "Запчасти / покупки",
  "Мойка / уход",
  "Документы / страховка",
  "Тюнинг",
  "Другое",
] as const;

export const ITEM_KINDS: { value: ItemKind; label: string; placeholder: string }[] = [
  { value: "parts", label: "Запчасти", placeholder: "Например: масло 5W-30" },
  { value: "labor", label: "Работа", placeholder: "Например: замена масла" },
  { value: "extra", label: "Другое", placeholder: "Например: расходники" },
];

export const itemKindLabel = (kind: ItemKind): string =>
  ITEM_KINDS.find((k) => k.value === kind)?.label ?? "Другое";

/** Єдине джерело меж: їх використовують схеми сервера, імпорт і форми. */
export const LIMITS = {
  cars: 50,
  service: 10000,
  fuel: 10000,
  reminders: 2000,
  photos: 5000,
  itemsPerRecord: 60,
  whatLength: 1000,
  noteLength: 1000,
  placeLength: 200,
  itemNameLength: 120,
  carNameLength: 80,
  personNameLength: 80,
  titleLength: 200,
  categoryLength: 80,
  maxOdo: 100_000_000,
  maxLiters: 100_000,
  maxSum: 10_000_000_000,
  // Безкоштовний план Workers дає 50 звернень до бази на запит: стільки вистачить і на запасний шлях по одній.
  opsPerRequest: 40,
  uploadBytes: 25 * 1024 * 1024,
} as const;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"] as const;

export const BACKUP_APP = "garage-amedro";
