// Перевірка живого сайту в браузері. Потрібен `wrangler login`.
// Turnstile не пускає автоматичний браузер, тому тестовий користувач із сесією створюється прямо в базі,
// а наприкінці видаляється через інтерфейс. Реєстрацію через форму цей скрипт не перевіряє.
// Запуск: node scripts/live-check.mjs
import { execSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

const BASE = "https://garage.dvoted.club";
const HOST = new URL(BASE).hostname;
const OUT = "tests/e2e/screenshots";
await mkdir(OUT, { recursive: true });

const sql = (command) =>
  execSync(`npx wrangler d1 execute garage --remote --json --command "${command}"`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

let failed = false;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed = true;
};
const norm = (s) => (s ?? "").replace(/ /g, " ").trim();

const browser = await chromium.launch();
const now = Math.floor(Date.now() / 1000);
const userId = randomUUID();
const email = `live-check-${userId.slice(0, 8)}@example.com`;
const password = randomBytes(18).toString("base64url");
const sessionFor = () => {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("base64url");
  return { token, hash };
};
const desktopSession = sessionFor();
const mobileSession = sessionFor();

sql(
  `INSERT INTO users (id, email, email_key, name, created_at) VALUES ('${userId}', '${email}', '${email}', 'Проверка', ${now});` +
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ('${desktopSession.hash}', '${userId}', ${now + 3600}, ${now});` +
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ('${mobileSession.hash}', '${userId}', ${now + 3600}, ${now});`,
);

async function openPage(options, session) {
  const ctx = await browser.newContext({ ...options, locale: "ru-RU", timezoneId: "Europe/Kyiv", acceptDownloads: true });
  await ctx.addCookies([
    { name: "__Host-session", value: session.token, domain: HOST, path: "/", secure: true, httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
  return { ctx, page, problems };
}

const addFuel = async (page, f) => {
  await page.getByRole("button", { name: "+ Заправка" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Дата").fill(f.date);
  await d.getByLabel("Пробег, км").fill(f.odo);
  await d.getByLabel("Литры").fill(f.liters);
  await d.getByLabel("Сумма ₴").fill(f.sum);
  await d.getByLabel("АЗС").fill(f.station);
  if (f.full === false) await d.getByLabel(/Полный бак/).uncheck();
  await d.getByRole("button", { name: "Сохранить" }).click();
};

try {
  const desktop = await openPage({ viewport: { width: 1280, height: 860 } }, desktopSession);
  const { page } = desktop;

  await page.goto(BASE);
  await page.getByRole("heading", { name: "Гараж пуст" }).waitFor();
  check("сесія з __Host-cookie читається", true);

  await page.getByRole("button", { name: "Посмотреть на примере" }).click();
  await page.getByRole("heading", { level: 1, name: "Демо-машина" }).waitFor();
  check("приклад: вкладено 27 093 ₴", norm(await page.locator(".gauge-main dd").textContent()) === "27 093 ₴");

  // Нагадування і розбивка затрат на живій базі.
  await page.getByRole("button", { name: "+ Сервис" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Дата").fill("2026-10-12");
  await d.getByLabel("Пробег, км").fill("328400");
  await d.getByLabel("Что сделано / куплено").fill("Замена масла и фильтров");
  await d.getByLabel("Где").fill("Автосервис");
  await d.getByRole("button", { name: "запчасти", exact: true }).click();
  await d.getByLabel("Название").nth(0).fill("Масло 5W-30, фильтры");
  await d.getByLabel("Сумма, ₴").nth(0).fill("5000");
  await d.getByRole("button", { name: "работа", exact: true }).click();
  await d.getByLabel("Название").nth(1).fill("Работа механика");
  await d.getByLabel("Сумма, ₴").nth(1).fill("3000");
  await d.getByRole("button", { name: "другое", exact: true }).click();
  await d.getByLabel("Название").nth(2).fill("Расходники");
  await d.getByLabel("Сумма, ₴").nth(2).fill("1000");
  await d.getByLabel("Напомнить через…").check();
  await d.getByLabel("Что нужно сделать или заменить").fill("Замена масла");
  await d.getByLabel("Через, км").fill("1400");
  await d.getByRole("button", { name: "Сохранить" }).click();

  await addFuel(page, { date: "2026-09-05", odo: "328300", liters: "20", sum: "1558", station: "АЗС у дома", full: false });
  await addFuel(page, { date: "2026-09-20", odo: "328600", liters: "30", sum: "2337", station: "АЗС на трассе" });
  await addFuel(page, { date: "2026-10-20", odo: "329100", liters: "38", sum: "2960", station: "АЗС у дома" });
  const alert = page.getByRole("alertdialog");
  await alert.waitFor();
  check("вікно нагадування за 1000 км", /Через 700 км — замена масла/.test(norm(await alert.textContent())));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/live-desktop-notify.png` });
  await alert.getByRole("button", { name: "Понятно" }).click();
  await page.waitForLoadState("networkidle");

  // Дані мають бути на сервері, а не лише на пристрої.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("heading", { level: 1, name: "Демо-машина" }).waitFor();
  check("після очищення браузера дані прийшли з сервера", norm(await page.locator(".gauge-main dd").textContent()) === "42 948 ₴");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/live-desktop-hero.png` });

  for (const [label, tab] of [["fuel", "Заправки"], ["reminders", "Напоминания"], ["gallery", "Галерея"], ["stats", "Статистика"], ["data", "Данные"], ["service", "Обслуживание"]]) {
    await page.getByRole("tab", { name: tab }).click();
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`вкладка «${tab}» без горизонтальної прокрутки`, overflow <= 1, overflow > 1 ? String(overflow) : "");
    await page.screenshot({ path: `${OUT}/live-desktop-${label}.png`, fullPage: true });
  }

  await page.getByRole("tab", { name: "Галерея" }).click();
  const connect = page.getByRole("link", { name: "Подключить Google Диск" });
  check("галерея пропонує підключити Диск", await connect.isVisible());
  const href = await connect.getAttribute("href");
  const google = await desktop.ctx.newPage();
  await google.goto(`${BASE}${href}`);
  const landed = new URL(google.url());
  check("кнопка веде на вхід Google без помилки", landed.hostname === "accounts.google.com" && !landed.pathname.includes("/error"), landed.pathname);
  await google.close();

  await page.getByRole("tab", { name: "Данные" }).click();
  const [txt] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Скачать весь гараж" }).click()]);
  check("бекап скачується в .txt", txt.suggestedFilename().endsWith(".txt"), txt.suggestedFilename());
  const text = await readFile(await txt.path(), "utf8");
  await page.getByLabel("Файл бэкапа").setInputFiles({ name: "backup.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  const restored = await page.getByRole("status").filter({ hasText: "Загружено" }).textContent();
  check("повторне відновлення без дублів", /добавлено 0, уже были — 10/.test(norm(restored)), norm(restored));
  const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Скачать таблицу .xlsx" }).click()]);
  check("таблиця скачується в .xlsx", xlsx.suggestedFilename().endsWith(".xlsx"));

  // Телефон: той самий акаунт, ті самі дані.
  const mobile = await openPage(devices["Pixel 7"], mobileSession);
  await mobile.page.goto(BASE);
  await mobile.page.getByRole("heading", { level: 1, name: "Демо-машина" }).waitFor();
  check("телефон бачить ті самі дані", norm(await mobile.page.locator(".gauge-main dd").textContent()) === "42 948 ₴");
  await mobile.page.waitForTimeout(1500);
  await mobile.page.screenshot({ path: `${OUT}/live-mobile-hero.png` });
  for (const [label, tab] of [["fuel", "Заправки"], ["reminders", "Напоминания"], ["stats", "Статистика"], ["service", "Обслуживание"]]) {
    await mobile.page.getByRole("tab", { name: tab }).click();
    await mobile.page.waitForTimeout(350);
    const overflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`телефон: «${tab}» без горизонтальної прокрутки`, overflow <= 1);
    await mobile.page.screenshot({ path: `${OUT}/live-mobile-${label}.png`, fullPage: true });
  }
  await mobile.ctx.close();

  // Пароль, вихід, вхід: справжня __Host-cookie від сервера.
  const pw = await page.evaluate(async (next) => {
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ next }),
    });
    return res.status;
  }, password);
  check("пароль задається", pw === 200);
  await page.reload();
  await page.getByRole("heading", { level: 1, name: "Демо-машина" }).waitFor();

  await page.getByRole("button", { name: /Профиль/ }).click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.getByRole("heading", { name: "Вход" }).waitFor();
  check("вихід повертає на вхід", true);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/live-desktop-auth.png` });

  await page.getByLabel("Почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Демо-машина" }).waitFor();
  const cookie = (await desktop.ctx.cookies()).find((c) => c.name === "__Host-session");
  check("вхід за паролем ставить безпечну cookie", Boolean(cookie?.secure && cookie?.httpOnly && cookie?.sameSite === "Lax"));

  await page.getByRole("button", { name: /Профиль/ }).click();
  await page.getByText("Удалить аккаунт").first().click();
  await page.getByLabel("Пароль для подтверждения").fill(password);
  await page.getByRole("button", { name: "Удалить аккаунт" }).click();
  await page.getByRole("heading", { name: "Вход" }).waitFor();
  check("акаунт видаляється", true);

  const csp = desktop.problems.filter((p) => /Content Security Policy/i.test(p));
  check("браузер не блокує нічого через CSP", csp.length === 0, csp[0]?.slice(0, 160));
  const other = desktop.problems.filter((p) => !/Content Security Policy|status of 401/i.test(p));
  check("без помилок у консолі", other.length === 0, other[0]?.slice(0, 160));
} catch (err) {
  check("сценарій завершився", false, String(err).split("\n")[0]);
} finally {
  await browser.close();
  sql(`DELETE FROM users WHERE id = '${userId}'`);
  const left = JSON.parse(sql("SELECT COUNT(*) AS n FROM users WHERE email LIKE 'live-check-%'"));
  check("тестових користувачів у базі не лишилось", left[0].results[0].n === 0);
}

console.log(failed ? "RESULT: PROBLEMS" : "RESULT: OK");
process.exit(failed ? 1 : 0);
