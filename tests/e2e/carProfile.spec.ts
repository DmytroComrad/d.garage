import { expect, test, type Page } from "@playwright/test";
import { addCar, expectNoHorizontalScroll, loadDemo, nb, openTab, register } from "./helpers";

/** Профиль машины: шестерёнка на вкладке «Данные», короткая строка под названием машины. */

const LINE = nb("2012 · Лифтбек · 1,6 л · AA1234BB");

const openProfile = async (page: Page, car: string) => {
  await openTab(page, "Данные");
  await page.getByRole("button", { name: `Профиль машины: ${car}` }).click();
  return page.getByRole("dialog", { name: "Профиль машины" });
};

test("профиль: заполняется шестерёнкой, виден под названием, переименование его не стирает", async ({ page, browser }) => {
  const { email, password } = await register(page);
  await addCar(page, "Ракета");

  const dialog = await openProfile(page, "Ракета");
  await dialog.getByLabel("Госномер").fill("aa1234bb");
  await dialog.getByLabel("Год выпуска").fill("2012");
  const vin = dialog.getByLabel("VIN");
  const vinHint = dialog.getByText("Современный VIN состоит из 17 знаков");
  await vin.fill("ab12o");
  await expect(vinHint).toBeVisible();
  await dialog.getByLabel("Кузов").selectOption({ label: "Лифтбек" });
  await dialog.getByLabel("Объём двигателя, л").fill("1,6");
  await dialog.getByLabel("Топливо").selectOption({ label: "Газ + бензин" });
  await dialog.getByLabel("Дата покупки").fill("2019-04-12");
  await dialog.getByLabel("Цена покупки, ₴").fill("185 000");
  await dialog.getByLabel("О машине").fill("От первого владельца");

  // Буквы O в VIN не бывает: форма не закрывается и объясняет почему.
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("VIN: от 5 до 17 латинских букв и цифр, без I, O и Q.");
  await vin.fill("wvw zzz 1jz 3w386752");
  await expect(vinHint).toBeHidden();
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog).toBeHidden();

  const line = page.locator(".hero-profile");
  await expect(line).toHaveText(LINE);
  await page.reload();
  await expect(line).toHaveText(LINE);

  // Переименование шлёт только название: профиль остаётся.
  await openTab(page, "Данные");
  await page.getByLabel("Название машины").fill("Ласточка");
  await page.locator(".car-row").getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ласточка" })).toBeVisible();
  await expect(line).toHaveText(LINE);
  await page.waitForLoadState("networkidle");

  // На другом устройстве всё пришло с сервера.
  const device = await browser.newContext({ locale: "ru-RU" });
  const phone = await device.newPage();
  await phone.goto("/");
  await phone.getByLabel("Почта").fill(email);
  await phone.getByLabel("Пароль").fill(password);
  await phone.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(phone.getByRole("heading", { level: 1, name: "Ласточка" })).toBeVisible();
  await expect(phone.locator(".hero-profile")).toHaveText(LINE);

  const again = await openProfile(phone, "Ласточка");
  await expect(again.getByLabel("VIN")).toHaveValue("WVWZZZ1JZ3W386752");
  await expect(again.getByLabel("Госномер")).toHaveValue("AA1234BB");
  await expect(again.getByLabel("Объём двигателя, л")).toHaveValue("1,6");
  await expect(again.getByLabel("Топливо")).toHaveValue("lpg_petrol");
  await expect(again.getByLabel("Дата покупки")).toHaveValue("2019-04-12");
  await expect(again.getByLabel("Цена покупки, ₴")).toHaveValue("185000");
  await expect(again.getByLabel("О машине")).toHaveValue("От первого владельца");
  await device.close();
});

test("профиль на узком телефоне: строка под названием и окно не вылезают за край", async ({ page }) => {
  await register(page);
  await loadDemo(page);
  await page.setViewportSize({ width: 320, height: 640 });
  const line = page.locator(".hero-profile");
  await expect(line).toHaveText(nb("2008 · Лифтбек · 1,8 л · AA 1234 BB"));
  await expectNoHorizontalScroll(page);

  const dialog = await openProfile(page, "Демо-машина");
  await expect(dialog.getByLabel("Кузов")).toHaveValue("liftback");
  const body = dialog.locator(".modal-body");
  expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await expectNoHorizontalScroll(page);
});
