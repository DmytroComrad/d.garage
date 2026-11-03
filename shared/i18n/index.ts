import { prefs, type Lang } from "../prefs";
import { en, type Messages } from "./en";
import { ru } from "./ru";
import { uk } from "./uk";

export type { Messages };

export const MESSAGES: Record<Lang, Messages> = { en, uk, ru };

/** Тексти поточної мови інтерфейсу. На сервері мову передають явно. */
export const messages = (lang: Lang = prefs().lang): Messages => MESSAGES[lang];

/** Назви мов у перемикачі: кожна своєю мовою, тож від вибраної мови не залежать. */
export const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  uk: "Українська",
  ru: "рузкій язичок",
};

/** Коди для атрибута lang і для локалі чисел. */
export const LOCALES: Record<Lang, string> = { en: "en-US", uk: "uk-UA", ru: "ru-RU" };
