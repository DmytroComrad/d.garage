// Скріншоти для перегляду дизайну. Потрібен запущений dev-сервер: node scripts/shots.mjs [baseUrl]
import { chromium, devices } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:5199";
const out = "tests/e2e/screenshots";
const browser = await chromium.launch();

async function run(name, ctxOptions, scheme) {
  const ctx = await browser.newContext({ ...ctxOptions, locale: "ru-RU", colorScheme: scheme });
  const page = await ctx.newPage();
  const shot = async (label, full = false) => {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${name}-${label}.png`, fullPage: full });
  };

  await page.goto(base);
  await page.getByRole("heading", { name: "Вход" }).waitFor();
  await shot("auth");

  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await page.getByLabel("Почта").fill(`shot-${crypto.randomUUID().slice(0, 10)}@example.com`);
  await page.getByLabel("Пароль").fill("correct horse battery");
  await page.getByRole("button", { name: "Создать гараж" }).click();
  await page.getByRole("heading", { name: "Гараж пуст" }).waitFor();
  await shot("empty");

  await page.getByRole("button", { name: "Посмотреть на примере" }).click();
  await page.getByRole("heading", { level: 1, name: "Демо-машина" }).waitFor();

  // Записи для наповнення: розбивка, неповний бак, нагадування.
  await page.getByRole("button", { name: "+ Сервис" }).first().click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Пробег, км").fill("328400");
  await d.getByLabel("Дата").fill("2026-10-12");
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
  await shot("form-service");
  await page.screenshot({ path: `${out}/${name}-form-service-full.png` });
  await d.getByRole("button", { name: "Сохранить" }).click();

  for (const [date, odo, liters, sum, full, station] of [
    ["2026-09-05", "328300", "20", "1558", false, "АЗС у дома"],
    ["2026-09-20", "328600", "30", "2337", true, "АЗС на трассе"],
    ["2026-10-20", "329100", "38", "2960", true, "АЗС у дома"],
  ]) {
    await page.getByRole("button", { name: "+ Заправка" }).first().click();
    d = page.getByRole("dialog");
    await d.getByLabel("Дата").fill(date);
    await d.getByLabel("Пробег, км").fill(odo);
    await d.getByLabel("Литры").fill(liters);
    await d.getByLabel("Сумма ₴").fill(sum);
    await d.getByLabel("АЗС").fill(station);
    if (!full) await d.getByLabel(/Полный бак/).uncheck();
    if (odo === "329100") await shot("form-fuel");
    await d.getByRole("button", { name: "Сохранить" }).click();
  }
  const alert = page.getByRole("alertdialog");
  await alert.waitFor();
  await shot("notify");
  await alert.getByRole("button", { name: "Понятно" }).click();

  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("hero");
  await shot("service", true);
  for (const [label, tab] of [["fuel", "Заправки"], ["reminders", "Напоминания"], ["gallery", "Галерея"], ["stats", "Статистика"], ["data", "Данные"]]) {
    await page.getByRole("tab", { name: tab }).click();
    await shot(label, true);
  }
  await page.getByRole("button", { name: /Профиль/ }).click();
  await shot("account");
  await ctx.close();
}

await run("desktop", { viewport: { width: 1280, height: 860 } }, "light");
await run("mobile", devices["Pixel 7"], "light");
await run("dark", { viewport: { width: 1280, height: 860 } }, "dark");
await run("mobiledark", devices["Pixel 7"], "dark");
await browser.close();
