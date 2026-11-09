import { LIMITS } from "./constants";
import { isPhone } from "./parse";
import type { Contact } from "./types";

/*
 * Контакти: усе, що однаково потрібно і сайту, і сторінці посилання на сервері.
 * vCard 3.0: його без питань відкривають і Android, і iPhone.
 */

/** Лише поля контакту: позначка «поділились» і все інше в бекап чи vCard не потрапляє. */
export const contactFields = (c: Contact): Contact => ({
  id: c.id,
  car: c.car,
  name: c.name,
  role: c.role,
  phone: c.phone,
  email: c.email,
  link: c.link,
  note: c.note,
});

/** Те, що бачить людина: без id і машини. Таке саме бачить і той, хто відкрив посилання. */
export type ContactCard = Pick<Contact, "name" | "role" | "phone" | "email" | "link" | "note">;

/** Цифри номера: так однаковий номер, записаний по-різному, вважається одним. */
export const phoneDigits = (phone: string): string => phone.replace(/\D/g, "");

/** Посилання для дзвінка: лише «+» і цифри, без пробілів і дужок. */
export const telHref = (phone: string): string => `tel:${phone.trim().startsWith("+") ? "+" : ""}${phoneDigits(phone)}`;

/** Адреса без протоколу й «www.»: «t.me/ivan» замість «https://t.me/ivan/». */
export const shortUrl = (url: string): string =>
  url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");

/** Керівні символи ламають рядки vCard: їх просто прибираємо. Переноси рядків лишаємо як \n. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

/** Текстове значення vCard: зворотна скісна, кома, крапка з комою й переноси рядків екрануються. */
export const vcardEscape = (value: string): string =>
  value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(/[\\,;]/g, (ch) => `\\${ch}`)
    .replace(/\n/g, "\\n");

const utf8Size = (ch: string): number => {
  const code = ch.codePointAt(0) ?? 0;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
};

/** Рядок vCard довший за 75 байтів UTF-8 переноситься: CRLF і пробіл. Літеру посередині не розрізаємо. */
export function vcardFold(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = utf8Size(ch);
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      // Наступні рядки починаються з пробілу, він теж рахується.
      limit = 74;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** Картка контакту для телефону: файл .vcf у UTF-8. */
export function buildVCard(c: ContactCard): string {
  const name = vcardEscape(c.name.trim());
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${name}`, `N:;${name};;;`];
  if (c.role) lines.push(`TITLE:${vcardEscape(c.role)}`);
  if (c.phone) lines.push(`TEL;TYPE=CELL:${vcardEscape(c.phone)}`);
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(c.email)}`);
  // Адреса — не текст, а URI: коми й крапки з комою в ній законні й не екрануються.
  if (c.link) lines.push(`URL:${c.link.replace(/[\r\n]/g, "").replace(CONTROL, "")}`);
  if (c.note) lines.push(`NOTE:${vcardEscape(c.note)}`);
  lines.push("END:VCARD");
  return `${lines.map(vcardFold).join("\r\n")}\r\n`;
}

/** Назва файлу з ім'я контакту: без символів, які не люблять файлові системи. */
export const vcardFileName = (name: string): string => {
  const safe = name
    .replace(CONTROL, "")
    .replace(/[\\/:*?"<>|\n]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .trim();
  return `${safe || "contact"}.vcf`;
};

/** Що повертає вибір контакту з телефону (Contact Picker API). */
export type PickedContact = { name?: unknown[]; tel?: unknown[]; email?: unknown[] };
export type ContactDraft = Pick<Contact, "name" | "phone" | "email">;

const texts = (list: unknown[] | undefined): string[] =>
  (list ?? []).map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);

/** Контакт із телефону → заготовка форми. Із кількох номерів беремо перший справжній. */
export function contactFromPicker(picked: PickedContact): ContactDraft {
  const phones = texts(picked.tel);
  return {
    name: (texts(picked.name)[0] ?? "").slice(0, LIMITS.contactNameLength),
    phone: (phones.find(isPhone) ?? phones[0] ?? "").slice(0, LIMITS.phoneLength),
    email: (texts(picked.email)[0] ?? "").slice(0, LIMITS.emailLength),
  };
}

/** За ім'ям, як у записнику телефону. */
export const sortContacts = <T extends Contact>(list: T[], collator: Intl.Collator): T[] =>
  [...list].sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));

/** Пошук: за ім'ям, заняттям, поштою, посиланням, нотаткою, а за цифрами — і за номером. */
export function filterContacts<T extends Contact>(list: T[], query: string): T[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return list;
  const digits = phoneDigits(q);
  return list.filter(
    (c) =>
      [c.name, c.role, c.email, c.link, c.note].some((v) => v.toLocaleLowerCase().includes(q)) ||
      (digits.length >= 3 && phoneDigits(c.phone).includes(digits)),
  );
}
