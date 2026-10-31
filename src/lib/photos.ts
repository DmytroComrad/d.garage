import { LIMITS } from "../../shared/constants";
import { genId } from "../../shared/format";
import type { Photo, PhotoKind, PhotoResponse } from "../../shared/types";
import { HttpError, errorText, postForm } from "./api";
import { addPhoto, flush, getState, resolveCarId, setDrive, setUploading, toast } from "./store";

const MAX_SIDE = 2400;
const QUALITY = 0.85;

type Prepared = { blob: Blob; name: string; width: number | null; height: number | null };

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));

/**
 * Перед завантаженням фото стискається прямо в браузері: місце на Диску користувача витрачається
 * повільніше, а перекодування прибирає з файлу геомітки та інші EXIF-дані.
 */
export async function prepareImage(file: File): Promise<Prepared> {
  const fallback: Prepared = { blob: file, name: file.name, width: null, height: null };
  if (file.type === "image/gif") return fallback;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return fallback;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await toBlob(canvas);
    if (!blob) return fallback;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return { blob, name: `${base}.jpg`, width, height };
  } catch {
    // Браузер не вміє цей формат (наприклад, HEIC у Chrome): вантажимо як є.
    return fallback;
  }
}

export type UploadTarget = { car: string; kind: PhotoKind; recordId: string | null };

export async function uploadPhotos(files: File[], target: UploadTarget): Promise<void> {
  if (!files.length) return;
  setUploading(files.length);
  await flush();

  let done = 0;
  for (const file of files) {
    try {
      if (file.size > LIMITS.uploadBytes) throw new HttpError(413, `«${file.name}» больше 25 МБ.`);
      const prepared = await prepareImage(file);
      const form = new FormData();
      form.set("id", genId());
      form.set("car", resolveCarId(target.car));
      form.set("kind", target.kind);
      if (target.recordId) form.set("recordId", target.recordId);
      if (prepared.width) form.set("width", String(prepared.width));
      if (prepared.height) form.set("height", String(prepared.height));
      form.set("file", prepared.blob, prepared.name);
      const { photo } = await postForm<PhotoResponse>("/api/photos", form);
      addPhoto(photo);
      done++;
    } catch (err) {
      if (err instanceof HttpError && err.code === "drive_disconnected") {
        setDrive({ ...getState().drive, connected: false });
      }
      toast(errorText(err));
    } finally {
      setUploading(-1);
    }
  }
  if (done) toast(done === 1 ? "Фото загружено" : `Загружено фото: ${done}`);
}

export const photoUrl = (photo: Pick<Photo, "id">, size: "thumb" | "full"): string =>
  `/api/photos/${encodeURIComponent(photo.id)}/${size}`;

export const driveFileUrl = (photo: Pick<Photo, "driveId">): string =>
  `https://drive.google.com/file/d/${encodeURIComponent(photo.driveId)}/view`;
