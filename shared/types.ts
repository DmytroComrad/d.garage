export type Car = { id: string; name: string };

export type ItemKind = "parts" | "labor" | "extra";

export type ServiceItem = {
  id: string;
  kind: ItemKind;
  name: string;
  sum: number;
};

export type ServiceRecord = {
  id: string;
  car: string;
  date: string; // YYYY-MM-DD
  odo: number | null;
  cat: string;
  what: string;
  where: string;
  sum: number;
  note: string;
  items: ServiceItem[];
};

export type FuelRecord = {
  id: string;
  car: string;
  date: string;
  odo: number;
  liters: number;
  sum: number;
  station: string;
  full: boolean;
  note: string;
};

/** Рівні сповіщення: 0 — ще рано, 1 — за 1000 км / 30 днів, 2 — за 500 км / 7 днів, 3 — термін настав. */
export type ReminderLevel = 0 | 1 | 2 | 3;

export type Reminder = {
  id: string;
  car: string;
  title: string;
  dueOdo: number | null;
  dueDate: string | null;
  done: boolean;
  doneDate: string | null;
  /** Найвищий рівень, про який уже показували спливаюче вікно. */
  notified: ReminderLevel;
  /** Запис, з якого створили нагадування. */
  recordId: string | null;
};

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

export type Op =
  | { type: "car.put"; data: Car }
  | { type: "car.del"; id: string }
  | { type: "service.put"; data: ServiceRecord }
  | { type: "service.del"; id: string }
  | { type: "fuel.put"; data: FuelRecord }
  | { type: "fuel.del"; id: string }
  | { type: "reminder.put"; data: Reminder }
  | { type: "reminder.del"; id: string }
  | { type: "demo.set"; value: boolean }
  | { type: "all.del" };

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
