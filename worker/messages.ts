import type { Context } from "hono";
import { isLang, type Lang } from "../shared/prefs";

/**
 * Тексти відповідей сервера трьома мовами. Помилка в коді — це ключ, а текст обирається
 * при відповіді за заголовком X-Lang, який шле застосунок. Без заголовка — англійська.
 */
const en = {
  configuring: "The service is being set up. Please try again later.",
  emailTaken: "This email is already registered. Sign in or reset your password.",
  badLogin: "Wrong email or password.",
  locked: "Too many failed attempts. Try again in 15 minutes.",
  resetExpired: "The link has expired. Request a new one.",
  wrongCurrentPassword: "The current password is wrong.",
  wrongPassword: "Wrong password.",
  typeEmail: "Type your email to confirm.",
  quota: "The record limit for this account has been reached.",
  dbDown: "The database is temporarily unavailable. Please try again later.",
  tooManyAttempts: "Too many attempts. Wait a minute and try again.",
  tooLarge: "The request is too large.",
  unreadable: "Couldn't read the request.",
  badData: "Invalid data.",
  captchaMissing: "Confirm that you're not a robot.",
  captchaFailed: "The bot check didn't pass. Please try again.",
  needLogin: "You need to sign in.",
  googleNotConfigured: "Google isn't set up on the server yet.",
  driveDisconnected: "Google Drive isn't connected.",
  googleDown: "Google isn't responding right now. Please try again later.",
  driveRevoked: "Access to Google Drive was revoked. Connect it again.",
  folderFailed: "Couldn't create a folder on Google Drive.",
  fileTooBig: "The file is too large: 25 MB max.",
  onlyImages: "Only photos can be uploaded: JPG, PNG, WebP, GIF or HEIC.",
  notImage: "The file doesn't look like an image.",
  carNotFound: "Car not found.",
  contactNotFound: "Contact not found. If you've just added it, wait until it's saved.",
  photoQuota: "The photo limit for this account has been reached.",
  manualQuota: "The materials limit for this account has been reached.",
  manualNotFound: "Material not found.",
  shareNotFound: "This link doesn't work: sharing was turned off or the link is wrong.",
  driveFull: "Google Drive refused: it may be out of space.",
  uploadFailed: "Couldn't upload the file to Google Drive.",
  photoNotFound: "Photo not found.",
  photoMissing: "The file is no longer on Google Drive.",
  sheetsDown: "Google Sheets isn't responding right now. Please try again later.",
  sheetCreateFailed: "Couldn't create the spreadsheet. Please try again later.",
  sheetUpdateFailed: "Couldn't update the spreadsheet. Please try again later.",
  sheetWriteFailed: "Couldn't write data to the spreadsheet. Please try again later.",
  noSheet: "There's no spreadsheet yet. Update it from the site first.",
  sheetDeleted: "The spreadsheet was deleted. Create a new one with the button above.",
  noBackupTabs: "The spreadsheet has no backup sheets.",
  sheetReadFailed: "Couldn't read the spreadsheet. Please try again later.",
  rejected: "Request rejected.",
  notFound: "Not found.",
  internal: "Something went wrong. Please try again.",
  insecure: "A secure connection is required.",
};

export type ErrorKey = keyof typeof en;

const uk: Record<ErrorKey, string> = {
  configuring: "Сервіс налаштовується. Спробуй пізніше.",
  emailTaken: "Таку пошту вже зареєстровано. Увійди або віднови пароль.",
  badLogin: "Неправильна пошта або пароль.",
  locked: "Забагато невдалих спроб. Спробуй через 15 хвилин.",
  resetExpired: "Посилання застаріло. Запроси нове.",
  wrongCurrentPassword: "Поточний пароль неправильний.",
  wrongPassword: "Пароль неправильний.",
  typeEmail: "Введи свою пошту для підтвердження.",
  quota: "Досягнуто ліміту записів на акаунт.",
  dbDown: "База тимчасово недоступна. Спробуй пізніше.",
  tooManyAttempts: "Забагато спроб. Зачекай хвилину й спробуй знову.",
  tooLarge: "Завеликий запит.",
  unreadable: "Не вдалося прочитати запит.",
  badData: "Некоректні дані.",
  captchaMissing: "Підтверди, що ти не робот.",
  captchaFailed: "Перевірку на робота не пройдено. Спробуй ще раз.",
  needLogin: "Потрібно увійти в акаунт.",
  googleNotConfigured: "Google поки не налаштовано на сервері.",
  driveDisconnected: "Google Диск не підключено.",
  googleDown: "Google зараз не відповідає. Спробуй пізніше.",
  driveRevoked: "Доступ до Google Диска відкликано. Підключи його знову.",
  folderFailed: "Не вдалося створити папку на Google Диску.",
  fileTooBig: "Файл завеликий: максимум 25 МБ.",
  onlyImages: "Можна завантажувати лише фото: JPG, PNG, WebP, GIF або HEIC.",
  notImage: "Файл не схожий на зображення.",
  carNotFound: "Машину не знайдено.",
  contactNotFound: "Контакт не знайдено. Якщо його щойно додано, зачекай, поки він збережеться.",
  photoQuota: "Досягнуто ліміту фото на акаунт.",
  manualQuota: "Досягнуто ліміту матеріалів на акаунт.",
  manualNotFound: "Матеріал не знайдено.",
  shareNotFound: "Посилання не працює: доступ вимкнули або посилання неправильне.",
  driveFull: "Google Диск відмовив: можливо, на ньому закінчилося місце.",
  uploadFailed: "Не вдалося завантажити файл на Google Диск.",
  photoNotFound: "Фото не знайдено.",
  photoMissing: "Файлу більше немає на Google Диску.",
  sheetsDown: "Google Таблиці зараз не відповідають. Спробуй пізніше.",
  sheetCreateFailed: "Не вдалося створити таблицю. Спробуй пізніше.",
  sheetUpdateFailed: "Не вдалося оновити таблицю. Спробуй пізніше.",
  sheetWriteFailed: "Не вдалося записати дані в таблицю. Спробуй пізніше.",
  noSheet: "Таблиці поки немає. Спершу онови її із сайту.",
  sheetDeleted: "Таблицю видалено. Створи нову кнопкою вище.",
  noBackupTabs: "У таблиці немає аркушів бекапу.",
  sheetReadFailed: "Не вдалося прочитати таблицю. Спробуй пізніше.",
  rejected: "Запит відхилено.",
  notFound: "Не знайдено.",
  internal: "Щось пішло не так. Спробуй ще раз.",
  insecure: "Потрібне захищене з'єднання.",
};

const ru: Record<ErrorKey, string> = {
  configuring: "Сервис настраивается. Попробуй позже.",
  emailTaken: "Такая почта уже зарегистрирована. Войди или восстанови пароль.",
  badLogin: "Неверная почта или пароль.",
  locked: "Слишком много неудачных попыток. Попробуй через 15 минут.",
  resetExpired: "Ссылка устарела. Запроси новую.",
  wrongCurrentPassword: "Текущий пароль неверный.",
  wrongPassword: "Пароль неверный.",
  typeEmail: "Введи свою почту для подтверждения.",
  quota: "Достигнут лимит записей на аккаунт.",
  dbDown: "База временно недоступна. Попробуй позже.",
  tooManyAttempts: "Слишком много попыток. Подожди минуту и попробуй снова.",
  tooLarge: "Слишком большой запрос.",
  unreadable: "Не получилось прочитать запрос.",
  badData: "Некорректные данные.",
  captchaMissing: "Подтверди, что ты не робот.",
  captchaFailed: "Проверка на робота не прошла. Попробуй ещё раз.",
  needLogin: "Нужно войти в аккаунт.",
  googleNotConfigured: "Google пока не настроен на сервере.",
  driveDisconnected: "Google Диск не подключён.",
  googleDown: "Google сейчас не отвечает. Попробуй позже.",
  driveRevoked: "Доступ к Google Диску отозван. Подключи его заново.",
  folderFailed: "Не получилось создать папку на Google Диске.",
  fileTooBig: "Файл слишком большой: максимум 25 МБ.",
  onlyImages: "Можно загружать только фото: JPG, PNG, WebP, GIF или HEIC.",
  notImage: "Файл не похож на изображение.",
  carNotFound: "Машина не найдена.",
  contactNotFound: "Контакт не найден. Если его только что добавили, подожди, пока он сохранится.",
  photoQuota: "Достигнут лимит фото на аккаунт.",
  manualQuota: "Достигнут лимит материалов на аккаунт.",
  manualNotFound: "Материал не найден.",
  shareNotFound: "Ссылка не работает: доступ выключили или ссылка неправильная.",
  driveFull: "Google Диск отказал: возможно, на нём закончилось место.",
  uploadFailed: "Не получилось загрузить файл на Google Диск.",
  photoNotFound: "Фото не найдено.",
  photoMissing: "Файла больше нет на Google Диске.",
  sheetsDown: "Google Таблицы сейчас не отвечают. Попробуй позже.",
  sheetCreateFailed: "Не получилось создать таблицу. Попробуй позже.",
  sheetUpdateFailed: "Не получилось обновить таблицу. Попробуй позже.",
  sheetWriteFailed: "Не получилось записать данные в таблицу. Попробуй позже.",
  noSheet: "Таблицы пока нет. Сначала обнови её с сайта.",
  sheetDeleted: "Таблица удалена. Создай новую кнопкой выше.",
  noBackupTabs: "В таблице нет листов бэкапа.",
  sheetReadFailed: "Не получилось прочитать таблицу. Попробуй позже.",
  rejected: "Запрос отклонён.",
  notFound: "Не найдено.",
  internal: "Что-то пошло не так. Попробуй ещё раз.",
  insecure: "Нужно защищённое соединение.",
};

const ERRORS: Record<Lang, Record<ErrorKey, string>> = { en, uk, ru };

type Mail = { subject: string; text: (link: string) => string; html: (link: string) => string };

const MAIL: Record<Lang, Mail> = {
  en: {
    subject: "Password recovery",
    text: (link) =>
      `To set a new password, open this link (it works for an hour):\n${link}\n\nIf this wasn't you, just ignore this email.`,
    html: (link) =>
      `<p>To set a new password, click the link. It works for an hour.</p><p><a href="${link}">Set a new password</a></p><p>If this wasn't you, just ignore this email.</p>`,
  },
  uk: {
    subject: "Відновлення пароля",
    text: (link) =>
      `Щоб задати новий пароль, відкрий посилання (діє годину):\n${link}\n\nЯкщо це був не ти, просто проігноруй лист.`,
    html: (link) =>
      `<p>Щоб задати новий пароль, натисни на посилання. Воно діє годину.</p><p><a href="${link}">Задати новий пароль</a></p><p>Якщо це був не ти, просто проігноруй лист.</p>`,
  },
  ru: {
    subject: "Восстановление пароля",
    text: (link) =>
      `Чтобы задать новый пароль, открой ссылку (действует час):\n${link}\n\nЕсли это был не ты, просто проигнорируй письмо.`,
    html: (link) =>
      `<p>Чтобы задать новый пароль, нажми на ссылку. Она действует час.</p><p><a href="${link}">Задать новый пароль</a></p><p>Если это был не ты, просто проигнорируй письмо.</p>`,
  },
};

export const SENDER_NAME = "D.Garage";

/** Мова відповіді: з заголовка, який шле застосунок. */
export const langOf = (header: string | null | undefined): Lang => (isLang(header) ? header : "en");
export const requestLang = (c: Context): Lang => langOf(c.req.header("x-lang"));

export const errorText = (lang: Lang, key: ErrorKey): string => ERRORS[lang][key];
export const mailText = (lang: Lang): Mail => MAIL[lang];
