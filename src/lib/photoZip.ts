import { Zip, ZipPassThrough } from "fflate";
import { archiveEntries, archiveFileName } from "../../shared/photoArchive";
import { todayISO } from "../../shared/format";
import { messages } from "../../shared/i18n";
import { downloadFile } from "./download";
import { canShowPhoto, photoUrl } from "./photos";
import { getState } from "./store";

/**
 * Збирає архів фото прямо в браузері: сервер лише віддає файли, як для галереї.
 * JPEG і так стиснений, тож файли кладуться без повторного стискання — це швидко й не гріє телефон.
 */
export async function downloadPhotoArchive(
  carId: string | undefined,
  onProgress: (done: number, total: number) => void,
): Promise<{ saved: number; failed: number }> {
  const state = getState();
  const t = messages();
  const entries = archiveEntries(
    state.data,
    { gallery: t.driveFolders.gallery, records: t.driveFolders.records, record: t.data.photosRecord },
    carId,
  ).filter((e) => canShowPhoto(e.photo, state.drive.connected));
  if (!entries.length) return { saved: 0, failed: 0 };

  const chunks: Uint8Array[] = [];
  const zip = new Zip();
  const done = new Promise<void>((resolve, reject) => {
    zip.ondata = (err, data, final) => {
      if (err) return reject(err);
      chunks.push(data);
      if (final) resolve();
    };
  });

  let saved = 0;
  let failed = 0;
  onProgress(0, entries.length);
  for (const [i, entry] of entries.entries()) {
    try {
      const res = await fetch(photoUrl(entry.photo, "full"), { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const file = new ZipPassThrough(entry.path);
      file.mtime = entry.mtime;
      zip.add(file);
      file.push(new Uint8Array(await res.arrayBuffer()), true);
      saved++;
    } catch {
      failed++;
    }
    onProgress(i + 1, entries.length);
  }
  zip.end();
  await done;

  if (saved) {
    const car = carId ? state.data.cars.find((c) => c.id === carId)?.name : undefined;
    downloadFile(archiveFileName(todayISO(), car), new Blob(chunks as BlobPart[], { type: "application/zip" }), "application/zip");
  }
  return { saved, failed };
}
