import type { z } from "zod";
import type { RawBackup } from "./backup";
import type { carSchema, fuelSchema, opSchema, reminderSchema, serviceItemSchema, serviceSchema } from "./schema";

/*
 * Типи записів виводяться зі схем сервера, тому не можуть від них розійтися.
 * Імпорт лише типовий: сама zod у браузер не потрапляє.
 */
export type Car = z.output<typeof carSchema>;
export type ServiceItem = z.output<typeof serviceItemSchema>;
export type ItemKind = ServiceItem["kind"];
export type ServiceRecord = z.output<typeof serviceSchema>;
export type FuelRecord = z.output<typeof fuelSchema>;
export type Reminder = z.output<typeof reminderSchema>;
export type Op = z.output<typeof opSchema>;

/** Рівні сповіщення: 0 — ще рано, 1 — за 1000 км / 30 днів, 2 — за 500 км / 7 днів, 3 — термін настав. */
export type ReminderLevel = Reminder["notified"];

export type PhotoKind = "gallery" | "record";

/** У базі лише текстові метадані: сам файл лежить на Google Диску користувача. */
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
  driveId: string;
};

export type GarageData = {
  cars: Car[];
  service: ServiceRecord[];
  fuel: FuelRecord[];
  reminders: Reminder[];
  photos: Photo[];
  demo: boolean;
};

export type Backup = {
  app: "garage-amedro";
  v: 2;
  saved: string;
  cars: Car[];
  service: ServiceRecord[];
  fuel: FuelRecord[];
  reminders: Reminder[];
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
export type SheetExportResponse = { url: string; exportedAt: number };
export type SheetImportResponse = { backup: RawBackup };

export type OpsResponse = {
  /** Номери операцій, які база не прийняла. */
  rejected: number[];
  /** Машини з уже наявною назвою: новий id → той, що в базі. */
  remapped: Record<string, string>;
};
