import { Hono, type Context } from "hono";
import { buildVCard, shortUrl, telHref, vcardFileName, type ContactCard } from "../shared/contacts";
import { MESSAGES } from "../shared/i18n";
import { isEmailAddress, isHttpUrl, isPhone } from "../shared/parse";
import { langFromAcceptLanguage, type Lang } from "../shared/prefs";
import type { ContactShareResponse } from "../shared/types";
import { randomToken, sha256 } from "./crypto";
import { clientIp, limitApi, limitAuth } from "./guard";
import { requireUser } from "./session";
import { ApiError, type AppEnv } from "./types";

/*
 * Посилання на один контакт. Токен випадковий і в базі лежить лише його SHA-256, як у сесій:
 * витік бази посилань не видає. Сторінка за посиланням відкривається без входу й показує
 * лише сам контакт — нічого про власника.
 */

/** 18 байтів — 144 біти: вгадати не вийде, а посилання коротке (24 символи). */
const TOKEN_BYTES = 18;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/* Власник: увімкнути чи вимкнути посилання. Це /api, тож діють сесія, перевірка походження й ліміти. */

export const contactShare = new Hono<AppEnv>();

contactShare.post("/:id/share", requireUser, async (c) => {
  const user = c.get("user");
  await limitApi(c, `share:${user.id}`);
  const id = c.req.param("id");
  if (!ID_RE.test(id)) throw new ApiError(404, "contactNotFound");
  const token = randomToken(TOKEN_BYTES);
  // Нове посилання замінює старе: попереднє одразу перестає відкриватися.
  const res = await c.env.DB.prepare("UPDATE contacts SET share_hash = ? WHERE user_id = ? AND id = ?")
    .bind(await sha256(token), user.id, id)
    .run();
  if (!res.meta.changes) throw new ApiError(404, "contactNotFound");
  return c.json({ url: `${c.env.APP_URL}/c/${token}` } satisfies ContactShareResponse);
});

contactShare.delete("/:id/share", requireUser, async (c) => {
  const user = c.get("user");
  await limitApi(c, `share:${user.id}`);
  const id = c.req.param("id");
  if (!ID_RE.test(id)) throw new ApiError(404, "contactNotFound");
  const res = await c.env.DB.prepare("UPDATE contacts SET share_hash = NULL WHERE user_id = ? AND id = ?")
    .bind(user.id, id)
    .run();
  if (!res.meta.changes) throw new ApiError(404, "contactNotFound");
  return c.json({ ok: true });
});

/* Публічна сторінка /c/<токен>: HTML із сервера, без жодного скрипта. */

export const sharePage = new Hono<AppEnv>();

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);

/** Посилання не має потрапити ні в пошук, ні в кеш, ні в Referer сайту, на який веде контакт. */
const PRIVATE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const STYLE = `
:root { color-scheme: light dark; --bg: #eef1f5; --surface: #fff; --ink: #12161c; --ink-2: #4a5563; --ink-3: #6f7a89; --line: #dce1e8; --accent: #2d6be0; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d1015; --surface: #161a21; --ink: #e8ecf1; --ink-2: #a7b1bf; --ink-3: #808b9b; --line: #283040; --accent: #4f86ec; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 16px 48px; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 440px; margin: 0 auto; padding: 24px 22px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; }
h1 { margin: 0; font-size: 24px; line-height: 1.25; overflow-wrap: anywhere; }
.role { margin: 4px 0 0; color: var(--ink-2); overflow-wrap: anywhere; }
dl { margin: 20px 0 0; display: grid; gap: 14px; }
dt { font-size: 13px; color: var(--ink-3); }
dd { margin: 2px 0 0; overflow-wrap: anywhere; }
.note { white-space: pre-line; }
a { color: var(--accent); }
.save { display: flex; align-items: center; justify-content: center; min-height: 48px; margin-top: 24px; border-radius: 10px; background: var(--ink); color: var(--bg); font-weight: 600; text-decoration: none; }
footer { max-width: 440px; margin: 16px auto 0; text-align: center; font-size: 13px; color: var(--ink-3); }
footer a { color: inherit; }
`;

/** Політика безпеки: скриптів немає зовсім, стилі — лише вбудовані з одноразовим nonce. */
function htmlResponse(status: 200 | 404 | 429 | 500, lang: Lang, title: string, body: string): Response {
  const nonce = randomToken(16);
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
  return new Response(html, {
    status,
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      Vary: "Accept-Language",
      ...(status === 429 ? { "Retry-After": "60" } : {}),
    },
  });
}

const pageLang = (c: Context<AppEnv>): Lang => langFromAcceptLanguage(c.req.header("accept-language"));

/** Одна сторінка і для чужого, і для вимкненого посилання: з відповіді не видно, чи воно колись існувало. */
const notFoundPage = (lang: Lang): Response => {
  const t = MESSAGES[lang].sharePage;
  return htmlResponse(
    404,
    lang,
    t.notFoundTitle,
    `<main><h1>${escapeHtml(t.notFoundTitle)}</h1><p class="role">${escapeHtml(t.notFoundText)}</p></main>
<footer><a href="/">D.Garage</a></footer>`,
  );
};

const row = (label: string, value: string, className = ""): string =>
  `<div><dt>${escapeHtml(label)}</dt><dd${className ? ` class="${className}"` : ""}>${value}</dd></div>`;

/** Кожне значення екрановане, а посилання ще раз перевірені: у href не потрапить нічого, крім tel:, mailto: і http(s). */
function contactPage(lang: Lang, card: ContactCard, token: string): Response {
  const t = MESSAGES[lang].sharePage;
  const rows: string[] = [];
  if (card.phone) {
    const text = escapeHtml(card.phone);
    rows.push(row(t.phone, isPhone(card.phone) ? `<a href="${escapeHtml(telHref(card.phone))}">${text}</a>` : text));
  }
  if (card.email) {
    const text = escapeHtml(card.email);
    rows.push(row(t.email, isEmailAddress(card.email) ? `<a href="mailto:${text}">${text}</a>` : text));
  }
  if (card.link) {
    rows.push(
      row(
        t.link,
        isHttpUrl(card.link)
          ? `<a href="${escapeHtml(card.link)}" rel="nofollow noopener noreferrer">${escapeHtml(shortUrl(card.link))}</a>`
          : escapeHtml(card.link),
      ),
    );
  }
  if (card.note) rows.push(row(t.note, escapeHtml(card.note), "note"));

  const body = `<main>
<h1>${escapeHtml(card.name)}</h1>
${card.role ? `<p class="role">${escapeHtml(card.role)}</p>` : ""}
${rows.length ? `<dl>${rows.join("\n")}</dl>` : ""}
<a class="save" href="/c/${escapeHtml(token)}/vcf" download="${escapeHtml(vcardFileName(card.name))}">${escapeHtml(t.save)}</a>
</main>
<footer>${escapeHtml(t.via)} <a href="/">D.Garage</a></footer>`;
  return htmlResponse(200, lang, `${card.name} · D.Garage`, body);
}

/** Ліміт на IP той самий, що й для токенів скидання пароля: перебір посилань упирається в нього. */
async function sharedCard(c: Context<AppEnv>, token: string): Promise<ContactCard | null> {
  await limitAuth(c, `share:${clientIp(c)}`);
  if (!TOKEN_RE.test(token)) return null;
  return c.env.DB.prepare("SELECT name, role, phone, email, link, note FROM contacts WHERE share_hash = ?")
    .bind(await sha256(token))
    .first<ContactCard>();
}

/** Ім'я файлу в заголовку: латиницею для старих браузерів і UTF-8 для решти (RFC 6266). */
const attachment = (name: string): string =>
  `attachment; filename="contact.vcf"; filename*=UTF-8''${encodeURIComponent(name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  )}`;

sharePage.get("/c/:token", async (c) => {
  const token = c.req.param("token");
  const card = await sharedCard(c, token);
  return card ? contactPage(pageLang(c), card, token) : notFoundPage(pageLang(c));
});

sharePage.get("/c/:token/vcf", async (c) => {
  const card = await sharedCard(c, c.req.param("token"));
  if (!card) return notFoundPage(pageLang(c));
  return new Response(buildVCard(card), {
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": attachment(vcardFileName(card.name)),
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});

sharePage.notFound((c) => notFoundPage(pageLang(c)));

sharePage.onError((err, c) => {
  const lang = pageLang(c);
  const t = MESSAGES[lang].sharePage;
  if (err instanceof ApiError && err.status === 429) {
    return htmlResponse(429, lang, t.tooMany, `<main><p>${escapeHtml(t.tooMany)}</p></main>`);
  }
  // Шлях у журнал не пишемо: у ньому токен посилання.
  console.error(JSON.stringify({ event: "share_page_error", name: err.name, message: err.message }));
  return htmlResponse(500, lang, t.error, `<main><p>${escapeHtml(t.error)}</p></main>`);
});
