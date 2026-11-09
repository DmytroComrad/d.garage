import { describe, expect, it } from "vitest";
import { archiveEntries, archiveFileName, safeName, withExtension } from "../../shared/photoArchive";
import type { Photo } from "../../shared/types";

const folders = { gallery: "Галерея", records: "Із записів", record: "Запис" };
const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 1000;
const photo = (over: Partial<Photo>): Photo => ({
  id: "p",
  car: "c1",
  kind: "gallery",
  recordId: null,
  name: "фото.jpg",
  mime: "image/jpeg",
  size: 1,
  width: null,
  height: null,
  createdAt: at("2026-08-17"),
  driveId: "",
  storage: "r2",
  ...over,
});
const data = (photos: Photo[]) => ({
  cars: [
    { id: "c1", name: "Мій Golf" },
    { id: "c2", name: "Дача: Нива?" },
  ],
  photos,
  service: [
    { id: "s1", car: "c1", date: "2026-08-20", odo: 1, cat: "Ремонт", what: "Заміна масла / фільтра", where: "", sum: 1, note: "", items: [] },
  ],
  fuel: [{ id: "f1", car: "c1", date: "2026-08-21", odo: 2, liters: 1, sum: 1, station: "", full: true, note: "", grade: null }],
});

describe("архів фото", () => {
  it("галерея — у папці машини з датою, фото із записів — у підпапці запису", () => {
    const entries = archiveEntries(
      data([
        photo({ id: "g1" }),
        photo({ id: "r1", kind: "record", recordId: "s1", name: "чек.png", mime: "image/png" }),
        photo({ id: "r2", kind: "record", recordId: "f1", name: "АЗС.jpg" }),
        photo({ id: "r3", kind: "record", recordId: "gone", name: "x.jpg" }),
      ]),
      folders,
    );
    expect(entries.map((e) => e.path)).toEqual([
      "Мій Golf/Галерея/2026-08-17 фото.jpg",
      "Мій Golf/Із записів/2026-08-20 Заміна масла фільтра/чек.png",
      "Мій Golf/Із записів/2026-08-21 Запис/АЗС.jpg",
      "Мій Golf/Із записів/Запис/x.jpg",
    ]);
    expect(entries[0].mtime.toISOString()).toBe("2026-08-17T12:00:00.000Z");
  });

  it("однакові імена не затирають одне одного, навіть різним регістром", () => {
    const entries = archiveEntries(data([photo({ id: "a" }), photo({ id: "b" }), photo({ id: "c", name: "ФОТО.jpg" })]), folders);
    expect(entries.map((e) => e.path)).toEqual([
      "Мій Golf/Галерея/2026-08-17 фото.jpg",
      "Мій Golf/Галерея/2026-08-17 фото (2).jpg",
      "Мій Golf/Галерея/2026-08-17 ФОТО (3).jpg",
    ]);
  });

  it("лише одна машина, без зниклих фото; службові символи прибрано з назв", () => {
    const entries = archiveEntries(
      data([photo({ id: "a", car: "c2", name: 'a/b:c*"d".jpg' }), photo({ id: "b" }), photo({ id: "m", car: "c2", storage: "missing" })]),
      folders,
      "c2",
    );
    expect(entries.map((e) => e.path)).toEqual(["Дача Нива/Галерея/2026-08-17 a b c d.jpg"]);
  });

  it("розширення відповідає вмісту, а назва архіву — даті й машині", () => {
    expect(withExtension("IMG_0001.HEIC", "image/jpeg")).toBe("IMG_0001.jpg");
    expect(withExtension("скрин", "image/png")).toBe("скрин.png");
    expect(safeName("  ...  ", "photo")).toBe("photo");
    expect(archiveFileName("2026-11-09")).toBe("d-garage-photos-2026-11-09.zip");
    expect(archiveFileName("2026-11-09", "Мій Golf")).toBe("d-garage-photos-Мій-Golf-2026-11-09.zip");
  });
});
