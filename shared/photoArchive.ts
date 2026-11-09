import { todayISO } from "./format";
import type { Car, FuelRecord, Photo, ServiceRecord } from "./types";

/*
 * Архів фото для користувача: власна копія всього, що лежить у сховищі.
 * Шляхи як у звичайній папці: «Машина/Галерея/2026-08-17 фото.jpg»,
 * а фото із записів — у підпапці запису: «Машина/Із записів/2026-08-17 Заміна масла/чек.jpg».
 */

export type ArchiveEntry = { photo: Photo; path: string; mtime: Date };

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** Ім'я, яке приймуть Windows, macOS і Android: без службових символів, крапок у кінці й надто довгих назв. */
export const safeName = (name: string, fallback: string, max = 80): string => {
  const clean = name
    .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, "");
  return clean || fallback;
};

/** Розширення файлу має відповідати тому, що всередині: HEIC, перекодований у JPEG, стає .jpg. */
export const withExtension = (name: string, mime: string): string => {
  const ext = EXT[mime];
  if (!ext) return name;
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[. ]+$/, "") || "photo";
  return `${base}.${ext}`;
};

/** Дата за місцевим часом людини: фото, зняте о першій ночі, не має потрапити у вчорашній день. */
const localDay = (seconds: number): string => todayISO(new Date(seconds * 1000));

export function archiveEntries(
  data: { cars: Car[]; photos: Photo[]; service: ServiceRecord[]; fuel: FuelRecord[] },
  folders: { gallery: string; records: string; record: string },
  carId?: string,
): ArchiveEntry[] {
  const cars = new Map(data.cars.map((c) => [c.id, c]));
  const records = new Map<string, { date: string; title: string }>();
  for (const r of data.service) records.set(r.id, { date: r.date, title: r.what });
  for (const r of data.fuel) records.set(r.id, { date: r.date, title: r.station });

  const used = new Set<string>();
  const unique = (path: string): string => {
    const dot = path.lastIndexOf(".");
    const [base, ext] = dot > path.lastIndexOf("/") ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
    let candidate = path;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };

  return [...data.photos]
    .filter((p) => p.storage !== "missing" && (!carId || p.car === carId) && cars.has(p.car))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((photo) => {
      const car = safeName(cars.get(photo.car)?.name ?? "", "car");
      const file = withExtension(safeName(photo.name, "photo", 100), photo.mime);
      const record = photo.kind === "record" && photo.recordId ? records.get(photo.recordId) : undefined;
      const path =
        photo.kind === "record"
          ? `${car}/${folders.records}/${record ? `${record.date} ${safeName(record.title, folders.record, 60)}` : folders.record}/${file}`
          : `${car}/${folders.gallery}/${localDay(photo.createdAt)} ${file}`;
      return { photo, path: unique(path), mtime: new Date(photo.createdAt * 1000) };
    });
}

export const archiveFileName = (today: string, carName?: string): string =>
  carName ? `d-garage-photos-${safeName(carName, "car").replace(/\s+/g, "-")}-${today}.zip` : `d-garage-photos-${today}.zip`;
