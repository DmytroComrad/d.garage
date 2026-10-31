// Перевірка живого сайту в справжньому браузері. Створює тестовий акаунт і видаляє його наприкінці.
// Запуск: node scripts/live-check.mjs [baseUrl]
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

const base = process.argv[2] ?? "https://garage.dvoted.club";
const out = "tests/e2e/screenshots";
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled"] });
let failed = false;

async function run(name, options) {
  const ctx = await browser.newContext({ ...options, locale: "ru-RU", timezoneId: "Europe/Kyiv" });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));

  const log = (...args) => console.log(`[${name}]`, ...args);
  const email = `live-check-${crypto.randomUUID().slice(0, 12)}@example.com`;
  const password = "live check password 1";

  try {
    await page.goto(base);
    await page.getByRole("heading", { name: "Вход" }).waitFor();
    log("login screen ok");
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${out}/live-${name}-auth.png` });

    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await page.getByLabel("Почта").fill(email);
    await page.getByLabel("Пароль").fill(password);

    const done = page.getByRole("heading", { name: "Гараж пуст" });
    const deadline = Date.now() + 40_000;
    let registered = false;
    while (Date.now() < deadline) {
      // Якщо Turnstile показав галочку, натискаємо її як людина: мишею по координатах.
      const widget = await page.locator(".turnstile").boundingBox().catch(() => null);
      if (widget) {
        await page.mouse.move(widget.x + 18, widget.y + 30, { steps: 12 });
        await page.waitForTimeout(350);
        await page.mouse.click(widget.x + 21, widget.y + 32);
        await page.waitForTimeout(3500);
      }
      await page.getByRole("button", { name: "Создать гараж" }).click().catch(() => undefined);
      await page.waitForTimeout(2500);
      if (await done.isVisible().catch(() => false)) {
        registered = true;
        break;
      }
    }
    if (!registered) {
      const alert = await page.getByRole("alert").textContent().catch(() => "");
      await page.screenshot({ path: `${out}/live-${name}-register-stuck.png` });
      log("REGISTER DID NOT COMPLETE. alert:", alert);
      failed = true;
      return;
    }
    log("registered (Turnstile passed)");

    await page.getByRole("button", { name: "Посмотреть на примере" }).click();
    await page.getByRole("heading", { level: 1, name: "Демо-машина" }).waitFor();
    const total = (await page.locator(".gauge-main dd").textContent())?.replace(/ /g, " ");
    log("total:", total);
    if (total !== "27 093 ₴") failed = true;
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${out}/live-${name}-garage.png` });

    await page.reload();
    await page.getByRole("heading", { level: 1, name: "Демо-машина" }).waitFor();
    log("data survived reload");

    for (const tab of ["Заправки", "Напоминания", "Галерея", "Статистика", "Данные", "Обслуживание"]) {
      await page.getByRole("tab", { name: tab }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) {
        log("HORIZONTAL OVERFLOW on", tab, overflow);
        failed = true;
      }
    }
    log("all tabs open, no horizontal scroll");

    const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).status);
    const fontOk = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check("16px 'Golos Text Variable'") && document.fonts.check("16px 'Unbounded Variable'");
    });
    log("manifest", manifest, "fonts loaded", fontOk);

    await page.getByRole("button", { name: /Профиль/ }).click();
    await page.getByText("Удалить аккаунт").first().click();
    await page.getByLabel("Пароль для подтверждения").fill(password);
    await page.getByRole("button", { name: "Удалить аккаунт" }).click();
    await page.getByRole("heading", { name: "Вход" }).waitFor();
    log("test account deleted");
  } catch (err) {
    failed = true;
    log("FAILED:", String(err).split("\n")[0]);
    await page.screenshot({ path: `${out}/live-${name}-failure.png` }).catch(() => undefined);
  } finally {
    const relevant = problems.filter((p) => !/status of 401/.test(p));
    log("console problems:", relevant.length ? relevant.slice(0, 8) : "none");
    if (relevant.some((p) => /Content Security Policy/i.test(p))) failed = true;
    await ctx.close();
  }
}

await run("desktop", { viewport: { width: 1280, height: 860 } });
await run("mobile", devices["Pixel 7"]);
await browser.close();
console.log(failed ? "RESULT: PROBLEMS" : "RESULT: OK");
