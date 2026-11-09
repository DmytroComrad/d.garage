import { describe, expect, it } from "vitest";
import { backupToText, buildBackup, mergeBackup, parseBackupText } from "../../shared/backup";
import {
  buildVCard,
  contactFromPicker,
  filterContacts,
  shortUrl,
  sortContacts,
  telHref,
  vcardEscape,
  vcardFileName,
  vcardFold,
} from "../../shared/contacts";
import { LIMITS } from "../../shared/constants";
import { applyOp, emptyData } from "../../shared/ops";
import { isEmailAddress, isPhone, normalizeContactLink } from "../../shared/parse";
import { LANGS, langFromAcceptLanguage } from "../../shared/prefs";
import { contactSchema } from "../../shared/schema";
import { buildSheets, sheetValues, sheetsToBackup } from "../../shared/sheet";
import type { Contact, ContactEntry } from "../../shared/types";
import { CAR } from "./fixtures";

const contact = (over: Partial<ContactEntry> = {}): ContactEntry => ({
  id: "ct1",
  car: CAR,
  name: "Іван Петренко",
  role: "Механік",
  phone: "+380 67 123 45 67",
  email: "ivan@example.com",
  link: "https://t.me/ivan_mech",
  note: "Пн–Пт до 18:00",
  shared: false,
  ...over,
});

/** Розгортання рядків vCard назад, як це робить телефон. */
const unfold = (card: string): string[] => card.replace(/\r\n /g, "").split("\r\n");
const utf8 = (s: string) => new TextEncoder().encode(s).length;

describe("vCard", () => {
  it("UTF-8, CRLF, усі поля й обов'язкові N та FN", () => {
    const card = buildVCard(contact());
    expect(card.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(card.endsWith("END:VCARD\r\n")).toBe(true);
    expect(card).not.toMatch(/[^\r]\n/);
    expect(unfold(card)).toEqual([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Іван Петренко",
      "N:;Іван Петренко;;;",
      "TITLE:Механік",
      "TEL;TYPE=CELL:+380 67 123 45 67",
      "EMAIL;TYPE=INTERNET:ivan@example.com",
      "URL:https://t.me/ivan_mech",
      "NOTE:Пн–Пт до 18:00",
      "END:VCARD",
      "",
    ]);
  });

  it("порожні поля не пишуться зовсім", () => {
    const card = buildVCard(contact({ role: "", phone: "", email: "", link: "", note: "" }));
    expect(unfold(card)).toEqual(["BEGIN:VCARD", "VERSION:3.0", "FN:Іван Петренко", "N:;Іван Петренко;;;", "END:VCARD", ""]);
  });

  it("кома, крапка з комою, зворотна скісна й переноси рядків екрануються", () => {
    expect(vcardEscape("a,b;c\\d\r\ne\nf\rg")).toBe("a\\,b\\;c\\\\d\\ne\\nf\\ng");
    // Керівні символи прибираються, щоб не зламати рядок.
    expect(vcardEscape("x\u0000y\u0007z\tw")).toBe("xyzw");
    const card = buildVCard(contact({ name: "СТО «Мотор», Київ; бокс 2", note: "рядок 1\nрядок 2" }));
    expect(unfold(card)).toContain("FN:СТО «Мотор»\\, Київ\\; бокс 2");
    expect(unfold(card)).toContain("NOTE:рядок 1\\nрядок 2");
  });

  it("посилання — це URI: коми в ньому не екрануються, а переноси рядків не проходять", () => {
    const card = buildVCard(contact({ link: "https://example.com/a,b;c\r\nX-EVIL:1" }));
    expect(unfold(card)).toContain("URL:https://example.com/a,b;cX-EVIL:1");
    expect(unfold(card).some((l) => l.startsWith("X-EVIL"))).toBe(false);
  });

  it("довгі рядки переносяться не довше 75 байтів і не посеред літери", () => {
    const note = "Дуже довга нотатка про механіка, який працює без вихідних і завжди бере трубку ".repeat(4);
    const card = buildVCard(contact({ note }));
    for (const line of card.split("\r\n")) expect(utf8(line)).toBeLessThanOrEqual(75);
    expect(unfold(card)).toContain(`NOTE:${vcardEscape(note)}`);
    expect(vcardFold("коротко")).toBe("коротко");
    // Емодзі — 4 байти: не розрізається навпіл.
    const emoji = vcardFold(`NOTE:${"🚗".repeat(30)}`);
    expect(emoji.split("\r\n ").join("")).toBe(`NOTE:${"🚗".repeat(30)}`);
    for (const line of emoji.split("\r\n")) expect(utf8(line)).toBeLessThanOrEqual(75);
  });

  it("назва файлу з ім'я контакту, без заборонених символів", () => {
    expect(vcardFileName("Іван Петренко")).toBe("Іван Петренко.vcf");
    expect(vcardFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j.vcf");
    expect(vcardFileName("  ")).toBe("contact.vcf");
    expect(vcardFileName("я".repeat(200))).toBe(`${"я".repeat(60)}.vcf`);
  });
});

describe("поля контакту", () => {
  it("телефон: цифри й звичні роздільники, без літер", () => {
    for (const ok of ["+380 67 123 45 67", "(067) 123-45-67", "0671234567", "+1 650.253.0000", "112"]) {
      expect(isPhone(ok), ok).toBe(true);
    }
    for (const bad of ["", "12", "дзвони", "+380 67 abc", "1+2", "tel:123", "1".repeat(21), " ".repeat(5)]) {
      expect(isPhone(bad), bad).toBe(false);
    }
    expect(isPhone("1".repeat(LIMITS.phoneLength + 1))).toBe(false);
  });

  it("пошта: кирилиця можна, а дописати тему чи адресатів до mailto: не вийде", () => {
    for (const ok of ["ivan@example.com", "i.p+cars@mail.ua", "іван@пошта.укр"]) expect(isEmailAddress(ok), ok).toBe(true);
    for (const bad of ["ivan", "ivan@", "@x.ua", "a b@c.ua", "a@b", "a@b.c?subject=x", "a@b.c,d@e.f", "a@b.c&cc=d", "<a@b.c>"]) {
      expect(isEmailAddress(bad), bad).toBe(false);
    }
  });

  it("посилання: як у хотілках, плюс @ім'я з Telegram", () => {
    expect(normalizeContactLink("t.me/ivan_mech")).toBe("https://t.me/ivan_mech");
    expect(normalizeContactLink("@ivan_mech")).toBe("https://t.me/ivan_mech");
    expect(normalizeContactLink(" https://sto.ua ")).toBe("https://sto.ua");
    expect(normalizeContactLink("javascript:alert(1)")).toBeNull();
    expect(normalizeContactLink("@x")).toBeNull();
  });

  it("схема сервера перевіряє те саме", () => {
    const { shared: _, ...plain } = contact();
    expect(contactSchema.safeParse(plain).success).toBe(true);
    expect(contactSchema.safeParse({ ...plain, phone: "", email: "", link: "", role: "", note: "" }).success).toBe(true);
    for (const bad of [{ name: "" }, { phone: "abc" }, { email: "x" }, { link: "ftp://x.ua" }, { link: "javascript:x" }]) {
      expect(contactSchema.safeParse({ ...plain, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    // Позначку «поділились» клієнт не надсилає: сервер її просто не читає.
    expect(contactSchema.parse({ ...plain, shared: true })).not.toHaveProperty("shared");
  });

  it("посилання для дзвінка — лише + і цифри", () => {
    expect(telHref("+380 (67) 123-45-67")).toBe("tel:+380671234567");
    expect(telHref("067 123 45 67")).toBe("tel:0671234567");
    expect(shortUrl("https://www.sto.ua/")).toBe("sto.ua");
    expect(shortUrl("https://t.me/ivan")).toBe("t.me/ivan");
  });

  it("контакт із телефону: перший справжній номер і пошта", () => {
    expect(contactFromPicker({ name: ["  Іван  "], tel: ["", "дім", "+380 67 123 45 67"], email: ["ivan@example.com"] })).toEqual({
      name: "Іван",
      phone: "+380 67 123 45 67",
      email: "ivan@example.com",
    });
    expect(contactFromPicker({})).toEqual({ name: "", phone: "", email: "" });
    expect(contactFromPicker({ name: ["я".repeat(500)], tel: [42] }).name).toHaveLength(LIMITS.contactNameLength);
  });

  it("сортування за ім'ям і пошук за будь-яким полем чи цифрами номера", () => {
    const list = [
      contact({ id: "b", name: "Шиномонтаж", role: "", phone: "044 222 33 44" }),
      contact({ id: "a", name: "Автоелектрик", role: "Сергій", email: "", link: "", note: "" }),
      contact({ id: "c", name: "Іван", role: "Механік" }),
    ];
    const uk = new Intl.Collator("uk-UA");
    expect(sortContacts(list, uk).map((c) => c.name)).toEqual(["Автоелектрик", "Іван", "Шиномонтаж"]);
    expect(filterContacts(list, "  ").length).toBe(3);
    expect(filterContacts(list, "МЕХАН").map((c) => c.id)).toEqual(["c"]);
    expect(filterContacts(list, "2223344").map((c) => c.id)).toEqual(["b"]);
    expect(filterContacts(list, "222 33").map((c) => c.id)).toEqual(["b"]);
    expect(filterContacts(list, "t.me").map((c) => c.id)).toEqual(["b", "c"]);
  });
});

describe("мова сторінки за Accept-Language", () => {
  it("перша з наших мов за вагою, інакше англійська", () => {
    expect(langFromAcceptLanguage("uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("uk");
    expect(langFromAcceptLanguage("ru-RU,ru;q=0.9")).toBe("ru");
    expect(langFromAcceptLanguage("en-GB,en;q=0.9,uk;q=0.8")).toBe("en");
    expect(langFromAcceptLanguage("de-DE,de;q=0.9,ru;q=0.5,uk;q=0.6")).toBe("uk");
    expect(langFromAcceptLanguage("uk;q=0,ru;q=0.1")).toBe("ru");
    expect(langFromAcceptLanguage("pl,de")).toBe("en");
    expect(langFromAcceptLanguage("*")).toBe("en");
    expect(langFromAcceptLanguage("")).toBe("en");
    expect(langFromAcceptLanguage(null)).toBe("en");
  });
});

describe("контакти в даних", () => {
  it("правка не вимикає посилання, а видалення машини забирає її контакти", () => {
    let data = applyOp(emptyData(), { type: "contact.put", data: contact() });
    expect(data.contacts[0].shared).toBe(false);
    data = { ...data, contacts: data.contacts.map((c) => ({ ...c, shared: true })) };
    const { shared: _, ...edit } = contact({ role: "Електрик" });
    data = applyOp(data, { type: "contact.put", data: edit });
    expect(data.contacts[0]).toMatchObject({ role: "Електрик", shared: true });
    data = applyOp(data, { type: "car.del", id: CAR });
    expect(data.contacts).toEqual([]);
  });
});

describe("бекап із контактами", () => {
  const cars = [{ id: CAR, name: "Пасат" }];
  const data = {
    ...emptyData(),
    cars,
    contacts: [contact({ shared: true }), contact({ id: "ct2", name: "Шиномонтаж", phone: "", email: "", link: "" })],
  };
  let n = 0;
  const makeId = () => `new${++n}`;

  it("у файл потрапляють самі поля: позначки посилання там немає", () => {
    const text = backupToText(buildBackup(data));
    expect(text).not.toContain("shared");
    const back = JSON.parse(text);
    expect(back.v).toBe(4);
    expect(back.contacts[0]).toEqual({
      id: "ct1",
      car: CAR,
      name: "Іван Петренко",
      role: "Механік",
      phone: "+380 67 123 45 67",
      email: "ivan@example.com",
      link: "https://t.me/ivan_mech",
      note: "Пн–Пт до 18:00",
    } satisfies Contact);
  });

  it("повний цикл: файл → новий гараж, а повтор нічого не дублює", () => {
    const parsed = parseBackupText(backupToText(buildBackup(data)));
    if (!parsed.ok) throw new Error(parsed.error);
    const merged = mergeBackup(emptyData(), parsed.backup, makeId);
    expect(merged.added).toBe(2);
    expect(merged.contacts.map((c) => [c.name, c.car === merged.cars[0].id])).toEqual([
      ["Іван Петренко", true],
      ["Шиномонтаж", true],
    ]);
    expect(merged.contacts[0]).not.toHaveProperty("shared");

    const again = mergeBackup({ ...emptyData(), cars: merged.cars, contacts: merged.contacts }, parsed.backup, makeId);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(2);
  });

  it("дублікат — та сама машина, ім'я й номер; інший номер — інший контакт", () => {
    const raw = {
      cars,
      contacts: [
        { car: CAR, name: "Іван Петренко", phone: "+38067 123 4567" },
        { car: CAR, name: "ІВАН ПЕТРЕНКО", phone: "+380671234567" },
        { car: CAR, name: "Іван Петренко", phone: "+380 50 000 00 00" },
      ],
    };
    const merged = mergeBackup(data, raw, makeId);
    expect(merged.contacts.map((c) => c.phone)).toEqual(["+380 50 000 00 00"]);
    expect(merged.skipped).toBe(2);
  });

  it("зіпсовані поля стають порожніми, контакт без імені чи машини пропускається, посилань немає", () => {
    const raw = {
      cars,
      contacts: [
        {
          car: CAR,
          name: "  Петро  ",
          phone: "дзвони",
          email: "не пошта",
          link: "javascript:alert(1)",
          note: "н".repeat(5000),
          shared: true,
          shareToken: "AAAAAAAAAAAAAAAAAAAAAAAA",
        },
        { car: CAR, name: "" },
        { car: "нема", name: "Хтось" },
      ],
    };
    const merged = mergeBackup(emptyData(), raw, makeId);
    expect(merged.contacts).toHaveLength(1);
    expect(merged.contacts[0]).toMatchObject({ name: "Петро", phone: "", email: "", link: "" });
    expect(merged.contacts[0].note).toHaveLength(LIMITS.noteLength);
    expect(Object.keys(merged.contacts[0]).sort()).toEqual(["car", "email", "id", "link", "name", "note", "phone", "role"]);
    expect(merged.skipped).toBe(2);
    // Те, що злилося, приймає й сервер.
    for (const c of merged.contacts) expect(contactSchema.safeParse(c).success).toBe(true);
  });

  it("бекап лише однієї машини несе лише її контакти", () => {
    const two = { ...data, cars: [...cars, { id: "x", name: "Інша" }], contacts: [...data.contacts, contact({ id: "ct3", car: "x" })] };
    expect(buildBackup(two, "x").contacts.map((c) => c.id)).toEqual(["ct3"]);
  });
});

describe("лист «Контакти» в таблиці", () => {
  const data = {
    ...emptyData(),
    cars: [{ id: CAR, name: "Пасат" }],
    contacts: [contact({ shared: true }), contact({ id: "ct2", name: "Автоскло", phone: "", note: "рядок 1\nрядок 2" })],
  };

  it("усіма трьома мовами пишеться й читається назад однаково, без позначки посилання", () => {
    const back = LANGS.map((lang) => {
      const sheets = buildSheets(data, "2026-09-15", lang);
      const sheet = sheets[sheets.length - 1];
      expect(sheet.rows).toHaveLength(2);
      expect(JSON.stringify(sheet)).not.toMatch(/shared|true/);
      return sheetsToBackup(Object.fromEntries(sheets.map((s) => [s.title, sheetValues(s)])))?.contacts;
    });
    expect(back[0]).toEqual([
      { car: "Пасат", name: "Автоскло", role: "Механік", phone: "", email: "ivan@example.com", link: "https://t.me/ivan_mech", note: "рядок 1\nрядок 2" },
      { car: "Пасат", name: "Іван Петренко", role: "Механік", phone: "+380 67 123 45 67", email: "ivan@example.com", link: "https://t.me/ivan_mech", note: "Пн–Пт до 18:00" },
    ]);
    expect(back[1]).toEqual(back[0]);
    expect(back[2]).toEqual(back[0]);
  });

  it("з таблиці контакти доходять до гаража через те саме злиття", () => {
    const sheets = buildSheets(data, "2026-09-15", "uk");
    const raw = sheetsToBackup(Object.fromEntries(sheets.map((s) => [s.title, sheetValues(s)])));
    let n = 0;
    const merged = mergeBackup(emptyData(), raw!, () => `id${++n}`);
    expect(merged.contacts.map((c) => c.name).sort((a, b) => a.localeCompare(b, "uk"))).toEqual(["Автоскло", "Іван Петренко"]);
    expect(mergeBackup(data, raw!, () => "x").contacts).toEqual([]);
  });
});
