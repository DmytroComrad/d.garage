import type { z } from "zod";
import type { RawBackup } from "./backup";
import type {
  carProfileSchema,
  carSchema,
  contactSchema,
  fuelSchema,
  manualSchema,
  opSchema,
  reminderSchema,
  serviceItemSchema,
  serviceSchema,
  wishSchema,
} from "./schema";

/*
 * Типи записів виводяться зі схем сервера, тому не можуть від них розійтися.
 * Імпорт лише типовий: сама zod у браузер не потрапляє.
 */
/** Рік, VIN, номер, кузов, двигун, пальне й покупка. Порожнє поле — null. */
export type CarProfile = z.output<typeof carProfileSchema>;
/** Профіль приходить окремою операцією car.profile; машина з порожнім профілем його не має. */
export type Car = z.output<typeof carSchema> & { profile?: CarProfile };
export type ServiceItem = z.output<typeof serviceItemSchema>;
export type ItemKind = ServiceItem["kind"];
export type ServiceRecord = z.output<typeof serviceSchema>;
export type FuelRecord = z.output<typeof fuelSchema>;
export type Reminder = z.output<typeof reminderSchema>;
/** Хотілка: план на машину з приблизною ціною. Виконана може посилатись на запис обслуговування. */
export type Wish = z.output<typeof wishSchema>;
/** Файл мануала лежить у сховищі; тут лише те, що про нього знає сервер. */
export type ManualFile = { name: string; mime: string; size: number };
export type Manual = z.output<typeof manualSchema> & { file: ManualFile | null };
/** Контакт: механік, продавець запчастин, сервіс. Так його шле клієнт і так він лежить у бекапі. */
export type Contact = z.output<typeof contactSchema>;
/**
 * Контакт у даних гаража: сервер ще каже, чи ним поділились за посиланням.
 * Самого посилання (і навіть його хешу) клієнт не отримує.
 */
export type ContactEntry = Contact & { shared: boolean };
export type Op = z.output<typeof opSchema>;

/** Рівні сповіщення: 0 — ще рано, 1 — за 1000 км / 30 днів, 2 — за 500 км / 7 днів, 3 — термін настав. */
export type ReminderLevel = Reminder["notified"];

export type PhotoKind = "gallery" | "record";

/**
 * У базі лише текстові метадані, сам файл — у сховищі R2.
 * Старі фото ще можуть лежати лише на Google Диску користувача (storage: "drive"), поки їх не перенесено;
 * "missing" — на Диску їх видалили раніше, ніж ми встигли перенести.
 */
export type Photo = {
  id: string;
  car: string;
  kind: PhotoKind;
  recordId: string | null;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: number;
  /** Копія на Google Диску для фото, завантажених до переходу на R2; інакше порожньо. */
  driveId: string;
  storage: "r2" | "drive" | "missing";
};

export type GarageData = {
  cars: Car[];
  service: ServiceRecord[];
  fuel: FuelRecord[];
  reminders: Reminder[];
  wishes: Wish[];
  manuals: Manual[];
  contacts: ContactEntry[];
  photos: Photo[];
  demo: boolean;
};

export type Backup = {
  app: "d-garage";
  v: 4;
  saved: string;
  cars: Car[];
  service: ServiceRecord[];
  fuel: FuelRecord[];
  reminders: Reminder[];
  wishes: Wish[];
  /** Без посилань: вони не переносяться в інший акаунт. */
  contacts: Contact[];
};

export type User = {
  id: string;
  email: string;
  name: string;
  hasPassword: boolean;
  hasGoogle: boolean;
};

export type DriveStatus = {
  connected: boolean;
  email: string | null;
  sheetUrl: string | null;
  sheetExportedAt: number | null;
};

export type AppConfig = {
  googleLogin: boolean;
  drive: boolean;
  passwordReset: boolean;
  turnstileSiteKey: string | null;
};

/* Відповіді API: сервер перевіряє їх через satisfies, клієнт читає ті самі типи. */

export type StateResponse = { user: User; data: GarageData; drive: DriveStatus };
export type AuthResponse = { user: User };
export type PhotoResponse = { photo: Photo };
export type ManualResponse = { manual: Manual };
export type ManualShareResponse = { url: string | null };
export type SharedManualsResponse = { carName: string; own: boolean; items: Manual[] };
export type ImportManualsResponse = { manuals: Manual[] };
export type SheetExportResponse = { url: string; exportedAt: number };
export type SheetImportResponse = { backup: RawBackup };
/** Посилання на контакт показується лише раз: сервер зберігає тільки його хеш. */
export type ContactShareResponse = { url: string };

export type OpsResponse = {
  /** Номери операцій, які база не прийняла. */
  rejected: number[];
  /** Машини з уже наявною назвою: новий id → той, що в базі. */
  remapped: Record<string, string>;
};
