import { afterEach, describe, expect, it } from "vitest";
import { mergeBackup, parseBackupText } from "../../shared/backup";
import { categoryLabel } from "../../shared/constants";
import { fmtConsumption, fmtDate, fmtDist, fmtMoney, fmtPerDist, formatDate } from "../../shared/format";
import { MESSAGES, type Messages } from "../../shared/i18n";
import { applyOp, emptyData } from "../../shared/ops";
import { isHttpUrl, normalizeUrl } from "../../shared/parse";
import { DEFAULT_PREFS, LANGS, applyPrefs, fromKm, readPrefs, toKm, type Prefs } from "../../shared/prefs";
import { buildReminder, reminderDraft, reminderStatus } from "../../shared/reminders";
import { opSchema, wishSchema } from "../../shared/schema";
import { buildSheets, resolveSheetTabs, sheetValues, sheetsToBackup } from "../../shared/sheet";
import type { Reminder, Wish } from "../../shared/types";
import { CAR, fuel, service } from "./fixtures";

const nb = (s: string) => s.replace(/ /g, " ");
const use = (patch: Partial<Prefs>) => applyPrefs({ ...DEFAULT_PREFS, ...patch });

afterEach(() => applyPrefs(DEFAULT_PREFS));

const wish = (over: Partial<Wish> = {}): Wish => ({
  id: "w1",
  car: CAR,
  title: "Зимова гума",
  price: 14000,
  links: ["https://example.com/tires"],
  note: "",
  added: "2026-09-01",
  done: false,
  doneDate: null,
  recordId: null,
  ...over,
});

describe("словники", () => {
  /** Усі листки дерева: рядки й функції. Порожній рядок означає забутий переклад. */
  const leaves = (node: unknown, path = ""): [string, unknown][] =>
    node && typeof node === "object" && !Array.isArray(node)
      ? Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))
      : [[path, node]];

  it("у кожній мові ті самі ключі, без порожніх рядків", () => {
    const shape = leaves(MESSAGES.en).map(([k]) => k);
    for (const lang of LANGS) {
      const own = leaves(MESSAGES[lang]);
      expect(own.map(([k]) => k)).toEqual(shape);
      for (const [key, value] of own) {
        if (typeof value === "string") expect(value.trim(), `${lang}: ${key}`).not.toBe("");
      }
    }
  });

  it("кожна мова має 12 місяців", () => {
    for (const lang of LANGS) {
      const m: Messages = MESSAGES[lang];
      expect(m.months).toHaveLength(12);
      expect(m.monthsShort).toHaveLength(12);
    }
  });

  it("за замовчуванням англійська, кілометри й дд.мм.рррр", () => {
    expect(DEFAULT_PREFS).toEqual({ lang: "en", unit: "km", dateFormat: "dmy" });
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(readPrefs({ lang: "de", unit: "parsecs", dateFormat: 5 })).toEqual(DEFAULT_PREFS);
    expect(readPrefs({ lang: "uk", unit: "mi", dateFormat: "ymd" })).toEqual({ lang: "uk", unit: "mi", dateFormat: "ymd" });
  });

  it("категорії зберігаються як були, а показуються перекладом", () => {
    expect(categoryLabel("Ремонт", MESSAGES.en)).toBe("Repair");
    expect(categoryLabel("ТО / расходники", MESSAGES.uk)).toBe("ТО / витратні матеріали");
    expect(categoryLabel("Своя категорія", MESSAGES.en)).toBe("Своя категорія");
  });
});

describe("одиниці відстані", () => {
  it("милі туди й назад не зсуваються", () => {
    for (const miles of [0, 1, 7, 599, 62137, 99999, 123456]) expect(fromKm(toKm(miles, "mi"), "mi")).toBe(miles);
    expect(toKm(5000, "km")).toBe(5000);
    expect(toKm(1, "mi")).toBe(2);
    expect(fromKm(100000, "mi")).toBe(62137);
  });

  it("пробіг, витрата й ціна кілометра переводяться в милі", () => {
    use({ unit: "mi" });
    expect(nb(fmtDist(100000))).toBe("62,137 mi");
    // 7,84 л/100 км = 12,6 л/100 миль; 47,53 ₴/км = 76,49 ₴/милю.
    expect(nb(fmtConsumption(7.84))).toBe("12.6 L/100 mi");
    expect(nb(fmtPerDist(47.53))).toBe("76.49 ₴");
  });

  it("українською й російською — свої слова для миль", () => {
    use({ lang: "uk", unit: "mi" });
    expect(nb(fmtDist(toKm(1, "mi")))).toBe("1 миля");
    expect(nb(fmtDist(toKm(3, "mi")))).toBe("3 милі");
    expect(nb(fmtDist(toKm(600, "mi")))).toBe("600 миль");
    use({ lang: "ru", unit: "km" });
    expect(nb(fmtDist(500))).toBe("500 км");
    expect(nb(fmtMoney(1234.5))).toBe("1 234,50 ₴");
  });

  it("пороги нагадувань у милях — 600 і 300 миль", () => {
    const rem = { dueOdo: 100_000, dueDate: null };
    // 990 км до строку: у кілометрах це вже «за 1000 км», у милях (≈615 миль) ще рано.
    expect(reminderStatus(rem, 99_010, "2026-09-15").level).toBe(1);
    use({ unit: "mi" });
    expect(reminderStatus(rem, 99_010, "2026-09-15").level).toBe(0);
    expect(reminderStatus(rem, 99_100, "2026-09-15").level).toBe(1);
    expect(reminderStatus(rem, 99_600, "2026-09-15").level).toBe(2);
    expect(nb(reminderStatus(rem, 99_600, "2026-09-15").when)).toBe("In 249 mi");
  });

  it("«нагадати через» у милях рахується від пробігу в кілометрах", () => {
    use({ unit: "mi" });
    const draft = { on: true, title: "Oil", km: "5000", date: "" };
    const opts = { car: CAR, recordId: "s1", baseOdo: 100_000, fallbackTitle: "", today: "2026-09-15", makeId: () => "r" };
    const built = buildReminder(draft, opts);
    expect("reminder" in built && built.reminder?.dueOdo).toBe(108_047);
    // Форма показує ту саму відстань, яку ввели.
    const linked = { dueOdo: 108_047 } as Reminder;
    expect(reminderDraft(linked, 100_000).km).toBe("5000");
  });
});

describe("формат дати", () => {
  it("три формати, за замовчуванням європейський", () => {
    expect(fmtDate("2026-08-17")).toBe("17.08.2026");
    use({ dateFormat: "mdy" });
    expect(fmtDate("2026-08-17")).toBe("08/17/2026");
    use({ dateFormat: "ymd" });
    expect(fmtDate("2026-08-17")).toBe("2026-08-17");
    expect(formatDate("2026-01-02", "dmy")).toBe("02.01.2026");
  });
});

describe("тексти нагадувань іншими мовами", () => {
  it("українською — з правильними відмінками", () => {
    use({ lang: "uk" });
    const s = reminderStatus({ dueOdo: 100_000, dueDate: "2026-09-17" }, 100_120, "2026-09-15");
    expect(nb(s.when)).toBe("Прострочено на 120 км або через 2 дні");
  });

  it("англійською", () => {
    const s = reminderStatus({ dueOdo: null, dueDate: "2026-09-14" }, null, "2026-09-15");
    expect(s.when).toBe("Overdue by 1 day");
  });
});

describe("посилання в хотілках", () => {
  it("лише http і https", () => {
    expect(normalizeUrl("rozetka.com.ua/item/1")).toBe("https://rozetka.com.ua/item/1");
    expect(normalizeUrl("  https://olx.ua/x  ")).toBe("https://olx.ua/x");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("data:text/html,hi")).toBeNull();
    expect(normalizeUrl("не посилання")).toBeNull();
    expect(isHttpUrl("ftp://example.com")).toBe(false);
  });

  it("сервер не прийме небезпечне посилання", () => {
    expect(wishSchema.safeParse(wish()).success).toBe(true);
    expect(wishSchema.safeParse(wish({ links: ["javascript:alert(1)"] })).success).toBe(false);
    expect(wishSchema.safeParse(wish({ title: " " })).success).toBe(false);
    expect(opSchema.safeParse({ type: "wish.del", id: "w1" }).success).toBe(true);
  });
});

describe("хотілки в даних", () => {
  it("видалений запис витрат відв'язується від хотілки, машина забирає свої хотілки", () => {
    let data = applyOp(emptyData(), { type: "wish.put", data: wish({ recordId: "s1", done: true }) });
    data = applyOp(data, { type: "service.del", id: "s1" });
    expect(data.wishes[0].recordId).toBeNull();
    data = applyOp(data, { type: "car.del", id: CAR });
    expect(data.wishes).toEqual([]);
  });

  it("бекап переносить хотілки разом зі зв'язком із записом", () => {
    let n = 0;
    const makeId = () => `new${++n}`;
    const backup = {
      cars: [{ id: "old-car", name: "Пасат" }],
      service: [{ ...service[0], id: "old-s", car: "old-car" }],
      wishes: [
        { ...wish(), car: "old-car", recordId: "old-s", done: true, doneDate: "2026-09-02", links: ["https://ok.ua", "javascript:x"] },
        { ...wish({ title: "" }), car: "old-car" },
      ],
    };
    const merged = mergeBackup(emptyData(), backup, makeId, "2026-09-15");
    expect(merged.wishes).toHaveLength(1);
    const [w] = merged.wishes;
    expect(w.recordId).toBe(merged.service[0].id);
    expect(w.links).toEqual(["https://ok.ua"]);
    expect(w.done).toBe(true);
    expect(merged.skipped).toBe(1);

    // Повтор пропускається.
    const again = mergeBackup({ ...emptyData(), cars: merged.cars, wishes: merged.wishes }, backup, makeId);
    expect(again.wishes).toHaveLength(0);
  });

  it("бекап зі старою назвою проєкту теж читається", () => {
    expect(parseBackupText(JSON.stringify({ app: "garage-amedro", cars: [] })).ok).toBe(true);
    expect(parseBackupText(JSON.stringify({ app: "d-garage", cars: [] })).ok).toBe(true);
    expect(parseBackupText(JSON.stringify({ app: "other", cars: [] }))).toEqual({ ok: false, error: "notBackup" });
  });
});

describe("таблиця іншими мовами", () => {
  const data = {
    ...emptyData(),
    cars: [{ id: CAR, name: "Тест" }],
    service,
    fuel,
    wishes: [wish({ recordId: "s1", done: true, doneDate: "2026-09-02", links: ["https://a.ua/1", "https://b.ua/2"] })],
  };
  const toTabs = (lang: "en" | "uk" | "ru") =>
    Object.fromEntries(buildSheets(data, "2026-09-15", lang).map((s) => [s.title, sheetValues(s)]));

  it("англійська й українська таблиці читаються назад так само, як російська", () => {
    const fromRu = sheetsToBackup(toTabs("ru"));
    for (const lang of ["en", "uk"] as const) {
      const back = sheetsToBackup(toTabs(lang));
      expect(back).toEqual(fromRu);
    }
    // Категорії повертаються до тих рядків, що зберігаються в записах.
    expect((fromRu?.service as { cat: string }[]).map((s) => s.cat)).toEqual(service.map((s) => s.cat));
    expect(fromRu?.wishes).toEqual([
      expect.objectContaining({ title: "Зимова гума", price: 14000, links: ["https://a.ua/1", "https://b.ua/2"], done: true }),
    ]);
  });

  it("назви листів беруться тією мовою, якою названо більшість", () => {
    expect(resolveSheetTabs(["Зведення", "Обслуговування", "Заправки"])).toMatchObject({
      summary: "Зведення",
      service: "Обслуговування",
      fuel: "Заправки",
    });
    expect(resolveSheetTabs(["Summary", "Fill-ups"])).toEqual({ summary: "Summary", fuel: "Fill-ups" });
  });
});
