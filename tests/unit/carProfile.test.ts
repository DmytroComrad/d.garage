import { afterEach, describe, expect, it } from "vitest";
import { backupToText, buildBackup, mergeBackup, parseBackupText, readProfile } from "../../shared/backup";
import {
  EMPTY_PROFILE,
  isEmptyProfile,
  isVin,
  latestToday,
  normalizePlate,
  normalizeVin,
  parseEngine,
  parseProfileForm,
  profileDraft,
  profileSummary,
  withProfile,
  type ProfileDraft,
} from "../../shared/carProfile";
import { demoRecords } from "../../shared/demo";
import { MESSAGES } from "../../shared/i18n";
import { applyOp, emptyData, retargetOp } from "../../shared/ops";
import { DEFAULT_PREFS, LANGS, applyPrefs } from "../../shared/prefs";
import { carProfileSchema, opSchema } from "../../shared/schema";
import { buildSheets, sheetValues, sheetsToBackup } from "../../shared/sheet";
import type { Car, CarProfile, GarageData, Op } from "../../shared/types";

const today = "2026-11-09";
/** Нерозривний пробіл між числом і одиницею — як звичайний. */
const nb = (s: string) => s.replace(/ /g, " ");

const PROFILE: CarProfile = {
  year: 2012,
  vin: "WVWZZZ1JZ3W386752",
  plate: "AA1234BB",
  body: "liftback",
  engine: 1.6,
  fuelType: "lpg_petrol",
  purchaseDate: "2019-04-12",
  purchasePrice: 185000,
  about: "Від першого власника",
};

const draft = (over: Partial<ProfileDraft> = {}): ProfileDraft => ({
  year: "2012",
  vin: "wvw zzz 1jz 3w386752",
  plate: " aa  1234 bb ",
  body: "liftback",
  engine: "1,6",
  fuelType: "lpg_petrol",
  purchaseDate: "2019-04-12",
  purchasePrice: "185 000",
  about: "  Від першого власника ",
  ...over,
});

afterEach(() => applyPrefs(DEFAULT_PREFS));

describe("поля профілю", () => {
  it("VIN: без пробілів і великими літерами, 5–17 знаків без I, O і Q", () => {
    expect(normalizeVin(" wvw zzz 1jz 3w386752 ")).toBe("WVWZZZ1JZ3W386752");
    expect(isVin("WVWZZZ1JZ3W386752")).toBe(true);
    // Старі машини мають коротший номер.
    expect(isVin("AB123")).toBe(true);
    expect(isVin("AB12")).toBe(false);
    expect(isVin("WVWZZZ1JZ3W3867520")).toBe(false);
    for (const bad of ["WVWZZZ1JZ3W38675I", "WVWZZZ1JZ3W38675O", "WVWZZZ1JZ3W38675Q", "WVWZZZ1JZ3W38675-"]) {
      expect(isVin(bad), bad).toBe(false);
    }
  });

  it("номер: великими літерами й без зайвих пробілів", () => {
    expect(normalizePlate("  aa  1234   bb ")).toBe("AA 1234 BB");
    expect(normalizePlate("ка0001хх")).toBe("КА0001ХХ");
  });

  it("об'єм двигуна в літрах із комою чи крапкою, від 0,1 до 20", () => {
    expect(parseEngine("1.6")).toBe(1.6);
    expect(parseEngine("1,6 л")).toBe(1.6);
    expect(parseEngine("2.0L")).toBe(2);
    expect(parseEngine("1,25")).toBe(1.25);
    expect(parseEngine("1.333")).toBe(1.33);
    expect(parseEngine("")).toBeNull();
    for (const bad of ["0", "0,05", "25", "1600", "abc"]) expect(parseEngine(bad), bad).toBe("invalid");
  });

  it("найпізніше «сьогодні» на Землі — на 14 годин попереду UTC", () => {
    expect(latestToday(Date.parse("2026-11-09T09:59:00Z"))).toBe("2026-11-09");
    expect(latestToday(Date.parse("2026-11-09T10:00:00Z"))).toBe("2026-11-10");
  });
});

describe("форма профілю", () => {
  it("розбирає й нормалізує заповнені поля", () => {
    expect(parseProfileForm(draft(), today)).toEqual({ ok: true, profile: { ...PROFILE, plate: "AA 1234 BB" } });
  });

  it("порожні поля — порожній профіль", () => {
    const empty = Object.fromEntries(Object.keys(EMPTY_PROFILE).map((k) => [k, ""])) as ProfileDraft;
    expect(parseProfileForm(empty, today)).toEqual({ ok: true, profile: EMPTY_PROFILE });
  });

  it("рік — від 1900 до наступного", () => {
    expect(parseProfileForm(draft({ year: "2027" }), today)).toMatchObject({ ok: true, profile: { year: 2027 } });
    expect(parseProfileForm(draft({ year: "1900" }), today)).toMatchObject({ ok: true, profile: { year: 1900 } });
    for (const year of ["1899", "2028", "12", "20x2", "2012.5"]) {
      expect(parseProfileForm(draft({ year }), today), year).toEqual({ ok: false, error: "errYear" });
    }
  });

  it("помилки VIN, об'єму, дати й ціни", () => {
    expect(parseProfileForm(draft({ vin: "WVWZZZ1JZ3W38675O" }), today)).toEqual({ ok: false, error: "errVin" });
    expect(parseProfileForm(draft({ engine: "1600" }), today)).toEqual({ ok: false, error: "errEngine" });
    expect(parseProfileForm(draft({ purchaseDate: "2026-11-10" }), today)).toEqual({ ok: false, error: "errDate" });
    expect(parseProfileForm(draft({ purchaseDate: today }), today).ok).toBe(true);
    expect(parseProfileForm(draft({ purchasePrice: "дорого" }), today)).toEqual({ ok: false, error: "errPrice" });
  });

  it("невідомий кузов чи пальне — не вказано", () => {
    expect(parseProfileForm(draft({ body: "tank", fuelType: "kerosene" }), today)).toMatchObject({
      ok: true,
      profile: { body: null, fuelType: null },
    });
  });

  it("чернетка з профілю дає той самий профіль", () => {
    for (const lang of LANGS) {
      applyPrefs({ ...DEFAULT_PREFS, lang });
      expect(parseProfileForm(profileDraft(PROFILE), today)).toEqual({ ok: true, profile: PROFILE });
    }
  });
});

describe("схема сервера", () => {
  const parse = (over: Partial<Record<keyof CarProfile, unknown>>) => carProfileSchema.safeParse({ ...PROFILE, ...over });

  it("нормалізує VIN і номер, порожній рядок — не вказано", () => {
    const res = parse({ vin: " wvw zzz 1jz 3w386752", plate: "aa 1234  bb", about: "  " });
    expect(res.success && res.data).toMatchObject({ vin: "WVWZZZ1JZ3W386752", plate: "AA 1234 BB", about: null });
    expect(parse({ vin: "" }).data?.vin).toBeNull();
    expect(carProfileSchema.safeParse(EMPTY_PROFILE).success).toBe(true);
  });

  it("не приймає поганий VIN, рік, майбутню дату, чужий кузов чи пальне", () => {
    const tomorrow = new Date(Date.parse(`${latestToday()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const nextYear = new Date().getUTCFullYear() + 1;
    for (const bad of [
      { vin: "WVWZZZ1JZ3W38675O" },
      { vin: "AB1" },
      { year: 1899 },
      { year: nextYear + 1 },
      { year: 2012.5 },
      { purchaseDate: tomorrow },
      { purchaseDate: "2026-02-31" },
      { body: "tank" },
      { fuelType: "petrol95" },
      { engine: 0 },
      { engine: 21 },
      { purchasePrice: -1 },
      { plate: "A".repeat(17) },
      { about: "x".repeat(1001) },
    ]) {
      expect(parse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(parse({ year: nextYear }).success).toBe(true);
  });

  it("операція car.profile несе всі поля разом", () => {
    expect(opSchema.safeParse({ type: "car.profile", id: "car1", data: PROFILE }).success).toBe(true);
    const { about: _, ...partial } = PROFILE;
    expect(opSchema.safeParse({ type: "car.profile", id: "car1", data: partial }).success).toBe(false);
  });
});

describe("операції в браузері", () => {
  const car: Car = { id: "car1", name: "Ракета" };
  const base: GarageData = { ...emptyData(), cars: [car] };
  const withP = applyOp(base, { type: "car.profile", id: "car1", data: PROFILE });

  it("car.profile ставить профіль, порожній профіль його прибирає", () => {
    expect(withP.cars[0]).toEqual({ ...car, profile: PROFILE });
    const cleared = applyOp(withP, { type: "car.profile", id: "car1", data: EMPTY_PROFILE });
    expect(cleared.cars[0]).toEqual(car);
    expect("profile" in cleared.cars[0]).toBe(false);
  });

  it("перейменування не стирає профіль", () => {
    const renamed = applyOp(withP, { type: "car.put", data: { id: "car1", name: "Ластівка" } });
    expect(renamed.cars[0]).toEqual({ id: "car1", name: "Ластівка", profile: PROFILE });
  });

  it("профіль невідомої машини нічого не змінює", () => {
    expect(applyOp(base, { type: "car.profile", id: "nope", data: PROFILE }).cars).toEqual([car]);
  });

  it("машину злили з наявною: профіль переходить на справжній id", () => {
    const op: Op = { type: "car.profile", id: "new", data: PROFILE };
    expect(retargetOp(op, new Map([["new", "car1"]]))).toEqual({ ...op, id: "car1" });
  });

  it("withProfile і isEmptyProfile", () => {
    expect(isEmptyProfile(undefined)).toBe(true);
    expect(isEmptyProfile(EMPTY_PROFILE)).toBe(true);
    expect(isEmptyProfile({ ...EMPTY_PROFILE, about: "x" })).toBe(false);
    expect(withProfile({ ...car, profile: PROFILE }, EMPTY_PROFILE)).toEqual(car);
  });
});

describe("рядок під назвою машини", () => {
  it("лише заповнене, мовою інтерфейсу", () => {
    expect(nb(profileSummary(PROFILE, MESSAGES.en))).toBe(nb("2012 · Liftback · 1.6 L · AA1234BB"));
    applyPrefs({ ...DEFAULT_PREFS, lang: "uk" });
    expect(nb(profileSummary(PROFILE, MESSAGES.uk))).toBe(nb("2012 · Ліфтбек · 1,6 л · AA1234BB"));
    expect(profileSummary({ ...EMPTY_PROFILE, plate: "AA1234BB", vin: "WVWZZZ1JZ3W386752" })).toBe("AA1234BB");
    // «Інший» кузов нічого не каже.
    expect(profileSummary({ ...EMPTY_PROFILE, year: 1985, body: "other" })).toBe("1985");
    expect(profileSummary(undefined)).toBe("");
    expect(profileSummary(EMPTY_PROFILE)).toBe("");
  });
});

describe("профіль у бекапі", () => {
  const car: Car = { id: "car1", name: "Ракета", profile: PROFILE };
  const data = { ...emptyData(), cars: [car] };
  let n = 0;
  const makeId = () => `new${++n}`;

  it("їде з машиною у файлі й відновлюється в нову машину", () => {
    const parsed = parseBackupText(backupToText(buildBackup(data)));
    if (!parsed.ok) throw new Error("backup");
    const res = mergeBackup(emptyData(), parsed.backup, makeId, today);
    expect(res.cars).toEqual([{ id: res.cars[0].id, name: "Ракета" }]);
    expect(res.profiles).toEqual([{ car: res.cars[0].id, profile: PROFILE }]);

    // Те саме, що робить застосунок: машина, потім її профіль.
    let state = emptyData();
    for (const op of [
      ...res.cars.map((c): Op => ({ type: "car.put", data: c })),
      ...res.profiles.map(({ car: id, profile }): Op => ({ type: "car.profile", id, data: profile })),
    ]) {
      state = applyOp(state, op);
    }
    expect(state.cars[0].profile).toEqual(PROFILE);
  });

  it("наявний профіль не перезаписує, порожній — заповнює", () => {
    const own = { ...emptyData(), cars: [{ id: "mine", name: "ракета", profile: { ...EMPTY_PROFILE, plate: "BB0000BB" } }] };
    expect(mergeBackup(own, buildBackup(data), makeId, today).profiles).toEqual([]);
    const bare = { ...emptyData(), cars: [{ id: "mine", name: "ракета" }] };
    expect(mergeBackup(bare, buildBackup(data), makeId, today).profiles).toEqual([{ car: "mine", profile: PROFILE }]);
  });

  it("дві машини з бекапу на одну нашу: профіль бере перша", () => {
    const backup = { cars: [{ id: "a", name: "Ракета", profile: PROFILE }, { id: "b", name: "РАКЕТА", profile: { year: 1990 } }] };
    const res = mergeBackup(emptyData(), backup, makeId, today);
    expect(res.profiles).toHaveLength(1);
    expect(res.profiles[0].profile).toEqual(PROFILE);
  });

  it("старий бекап без профілю нічого не змінює", () => {
    const res = mergeBackup(emptyData(), { cars: [{ id: "a", name: "Ракета" }] }, makeId, today);
    expect(res.profiles).toEqual([]);
  });

  it("погане поле лишається порожнім, решта відновлюється", () => {
    expect(
      readProfile(
        {
          year: "2012",
          vin: "wvw zzz 1jz 3w38675O",
          plate: "  aa 1234 bb  ",
          body: "tank",
          engine: 35,
          fuelType: "diesel",
          purchaseDate: "2030-01-01",
          purchasePrice: 99999.999,
          about: 42,
        },
        today,
      ),
    ).toEqual({
      ...EMPTY_PROFILE,
      year: 2012,
      plate: "AA 1234 BB",
      fuelType: "diesel",
      purchasePrice: 100000,
    });
    expect(readProfile("сміття", today)).toEqual(EMPTY_PROFILE);
    // Таблиця могла зробити з VIN із самих цифр число.
    expect(readProfile({ vin: 1234567 }, today).vin).toBe("1234567");
  });
});

describe("профіль у таблиці", () => {
  const data = { ...emptyData(), cars: [{ id: "car1", name: "Ракета", profile: PROFILE }, { id: "car2", name: "Друга" }] };

  it("у зведенні мовою таблиці, назад читається з будь-якої мови", () => {
    for (const lang of LANGS) {
      const sheets = buildSheets(data, today, lang);
      const summary = sheets[0];
      const titles = summary.columns.map((c) => c.title);
      const row = summary.rows[0];
      const col = MESSAGES[lang].sheet.col;
      expect(row[titles.indexOf(col.body)]).toBe(MESSAGES[lang].carProfile.bodies.liftback);
      expect(row[titles.indexOf(col.fuelType)]).toBe(MESSAGES[lang].carProfile.fuels.lpg_petrol);
      expect(row[titles.indexOf(col.year)]).toBe(2012);
      expect(row[titles.indexOf(col.purchaseDate)]).toEqual({ date: "2019-04-12" });
      // Машина без профілю — порожні клітинки.
      expect(summary.rows[1].slice(titles.indexOf(col.year)).every((v) => v == null)).toBe(true);

      const tabs = Object.fromEntries(sheets.map((s) => [s.title, sheetValues(s)]));
      const backup = sheetsToBackup(tabs);
      if (!backup) throw new Error(lang);
      const res = mergeBackup(emptyData(), backup, () => `id-${lang}`, today);
      expect(res.profiles, lang).toEqual([{ car: `id-${lang}`, profile: PROFILE }]);
    }
  });

  it("підписи кузова й пального читаються будь-якою мовою, навіть під заголовками іншої", () => {
    const sheets = buildSheets(data, today, "en");
    const values = sheetValues(sheets[0]);
    const titles = values[0];
    values[1][titles.indexOf(MESSAGES.en.sheet.col.body)] = MESSAGES.ru.carProfile.bodies.liftback;
    values[1][titles.indexOf(MESSAGES.en.sheet.col.fuelType)] = "ГАЗ + БЕНЗИН";
    const backup = sheetsToBackup({ [sheets[0].title]: values });
    const cars = backup?.cars as { name: string; profile: Record<string, unknown> }[];
    expect(cars[0].profile).toMatchObject({ body: "liftback", fuelType: "lpg_petrol" });
  });
});

describe("демо", () => {
  it("демо-машина має правдоподібний профіль, який приймає сервер", () => {
    const demo = demoRecords(today);
    expect(isEmptyProfile(demo.profile)).toBe(false);
    expect(carProfileSchema.safeParse(demo.profile).success).toBe(true);
  });
});
