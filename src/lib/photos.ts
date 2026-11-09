import { LIMITS } from "../../shared/constants";
import { genId } from "../../shared/format";
import { messages } from "../../shared/i18n";
import type { Photo, PhotoKind, PhotoResponse } from "../../shared/types";
import { HttpError, errorText, postForm } from "./api";
import { addPhoto, flush, resolveCarId, setUploading, toast } from "./store";

const MAX_SIDE = 2400;
const THUMB_SIDE = 640;
const QUALITY = 0.85;
const THUMB_QUALITY = 0.8;

type Prepared = { blob: Blob; thumb: Blob | null; name: string; width: number | null; height: number | null };

/** Зображення, вписане в квадрат `side`, як JPEG. */
async function renderJpeg(bitmap: ImageBitmap, side: number, quality: number) {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return blob ? { blob, width, height } : null;
}

/**
 * Перед завантаженням фото стискається прямо в браузері, а поруч робиться мініатюра для списків:
 * сховище витрачається повільніше, а перекодування прибирає з файлу геомітки та інші EXIF-дані.
 */
export async function prepareImage(file: File): Promise<Prepared> {
  const fallback: Prepared = { blob: file, thumb: null, name: file.name, width: null, height: null };
  if (file.type === "image/gif") return fallback;
  try {
    const bitmap = await createImageBitmap(file);
    const full = await renderJpeg(bitmap, MAX_SIDE, QUALITY);
    const thumb = full ? await renderJpeg(bitmap, THUMB_SIDE, THUMB_QUALITY) : null;
    bitmap.close();
    if (!full) return fallback;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return { blob: full.blob, thumb: thumb?.blob ?? null, name: `${base}.jpg`, width: full.width, height: full.height };
  } catch {
    // Браузер не вміє цей формат (наприклад, HEIC у Chrome): вантажимо як є, сервер переведе в JPEG сам.
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
      if (file.size > LIMITS.uploadBytes) throw new HttpError(413, messages().photos.tooBig(file.name));
      const prepared = await prepareImage(file);
      const form = new FormData();
      form.set("id", genId());
      form.set("car", resolveCarId(target.car));
      form.set("kind", target.kind);
      if (target.recordId) form.set("recordId", target.recordId);
      if (prepared.width) form.set("width", String(prepared.width));
      if (prepared.height) form.set("height", String(prepared.height));
      form.set("file", prepared.blob, prepared.name);
      if (prepared.thumb) form.set("thumb", prepared.thumb, "thumb.jpg");
      const { photo } = await postForm<PhotoResponse>("/api/photos", form);
      addPhoto(photo);
      done++;
    } catch (err) {
      toast(errorText(err));
    } finally {
      setUploading(-1);
    }
  }
  if (done) toast(messages().photos.uploaded(done));
}

/** Де лежить фото. Кеш старої версії застосунку поля не має: тоді це фото ще з Диска. */
export const photoStorage = (photo: Pick<Photo, "storage">): Photo["storage"] => photo.storage ?? "drive";

/** Чи вдасться показати фото: зі сховища завжди, з Диска — лише поки він підключений. */
export const canShowPhoto = (photo: Pick<Photo, "storage">, driveConnected: boolean): boolean => {
  const storage = photoStorage(photo);
  return storage === "r2" || (storage === "drive" && driveConnected);
};

export const photoUrl = (photo: Pick<Photo, "id">, size: "thumb" | "full"): string =>
  `/api/photos/${encodeURIComponent(photo.id)}/${size}`;

export const driveFileUrl = (photo: Pick<Photo, "driveId">): string =>
  `https://drive.google.com/file/d/${encodeURIComponent(photo.driveId)}/view`;
