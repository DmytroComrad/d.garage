import { expect, type Page } from "@playwright/test";

export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Сравнение без разницы между обычным и неразрывным пробелом. */
export const nb = (text: string): RegExp =>
  new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s\\u00a0]"));

export async function register(page: Page): Promise<{ email: string; password: string }> {
  const email = `e2e-${crypto.randomUUID().slice(0, 12)}@example.com`;
  const password = "correct horse battery";
  await page.goto("/");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await page.getByLabel("Почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Создать гараж" }).click();
  await expect(page.getByRole("heading", { name: "Гараж пуст" })).toBeVisible();
  return { email, password };
}

export async function addCar(page: Page, name: string): Promise<void> {
  const empty = page.getByRole("button", { name: "Добавить машину" });
  if (await empty.first().isVisible().catch(() => false)) await empty.first().click();
  else await page.getByRole("button", { name: "+ машина" }).click();
  await page.getByLabel("Как называешь машину").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Добавить машину" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

export async function addFuel(
  page: Page,
  f: { date?: string; odo: string; liters: string; sum: string; station?: string; full?: boolean },
): Promise<void> {
  await page.getByRole("button", { name: "+ Заправка" }).first().click();
  const dialog = page.getByRole("dialog");
  if (f.date) await dialog.getByLabel("Дата").fill(f.date);
  await dialog.getByLabel("Пробег, км").fill(f.odo);
  await dialog.getByLabel("Литры").fill(f.liters);
  await dialog.getByLabel("Сумма ₴").fill(f.sum);
  if (f.station) await dialog.getByLabel("АЗС").fill(f.station);
  if (f.full === false) await dialog.getByLabel(/Полный бак/).uncheck();
  await dialog.getByRole("button", { name: "Сохранить" }).click();
}

export async function loadDemo(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Посмотреть на примере" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Демо-машина" })).toBeVisible();
}

export const openTab = (page: Page, name: string) => page.getByRole("tab", { name }).click();

/** Сторінка не повинна скролитись горизонтально ніде. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];
    if (doc.scrollWidth > doc.clientWidth + 1) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const r = el.getBoundingClientRect();
        if (r.right > doc.clientWidth + 1 && !el.closest(".tabs, .car-chips, .table-scroll, .segmented")) {
          offenders.push(`${el.tagName}.${el.className} right=${Math.round(r.right)}`);
        }
      }
    }
    return { scroll: doc.scrollWidth, client: doc.clientWidth, offenders: offenders.slice(0, 8) };
  });
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
}
