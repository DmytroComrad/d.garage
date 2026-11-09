import { expect, test, type Page } from "@playwright/test";
import { addCar, expectNoHorizontalScroll, nb, openTab, register } from "./helpers";

/*
 * Валюти. Курси в e2e сталі (FX_TEST_RATES у wrangler.e2e.jsonc): 1 $ = 41,5 ₴, 1 € = 48,25 ₴,
 * тож перерахунок відомий наперед, а НБУ тести не чіпають.
 */

const openProfile = (page: Page) => page.getByRole("button", { name: /Профиль|Profile|Профіль/ }).click();

test("основная валюта $: записи в € и ₴ в своих валютах, итоги в $ с гривной рядом", async ({ page }) => {
  await register(page);
  await addCar(page, "Валютная");

  await openProfile(page);
  const profile = page.getByRole("dialog");
  const mainGroup = profile.getByRole("group", { name: "Основная валюта" });
  const secondGroup = profile.getByRole("group", { name: "Дополнительная валюта" });
  // Для русского по умолчанию: гривна основная, доллар рядом.
  await expect(mainGroup.getByRole("button", { name: "₴ UAH" })).toHaveAttribute("aria-pressed", "true");
  await expect(secondGroup.getByRole("button", { name: "$ USD" })).toHaveAttribute("aria-pressed", "true");
  await mainGroup.getByRole("button", { name: "$ USD" }).click();
  // Доллар был дополнительной валютой: теперь они поменялись местами.
  await expect(mainGroup.getByRole("button", { name: "$ USD" })).toHaveAttribute("aria-pressed", "true");
  await expect(secondGroup.getByRole("button", { name: "₴ UAH" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Закрыть" }).click();

  // Сервис в евро: форма предлагает основную валюту, выбираем другую.
  await page.getByRole("button", { name: "+ Сервис" }).first().click();
  const form = page.getByRole("dialog");
  await expect(form.getByLabel("Валюта")).toHaveValue("USD");
  await form.getByLabel("Что сделано / куплено").fill("Зимние шины");
  await form.getByLabel("Валюта").selectOption("EUR");
  await form.getByLabel("Сумма €").fill("100");
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(form).toBeHidden();

  // Заправка в гривнах: цена литра — тоже в гривнах.
  await page.getByRole("button", { name: "+ Заправка" }).first().click();
  const fuel = page.getByRole("dialog");
  await fuel.getByLabel("Пробег, км").fill("1000");
  await fuel.getByLabel("Литры").fill("40");
  await fuel.getByLabel("Валюта").selectOption("UAH");
  await fuel.getByLabel("Сумма ₴").fill("2000");
  await expect(fuel).toContainText(nb("≈ 50,00 ₴/л"));
  await fuel.getByRole("button", { name: "Сохранить" }).click();
  await expect(fuel).toBeHidden();

  // Итоги — в долларах по курсу на дату записи: 100 € = 116,27 $, 2000 ₴ = 48,19 $. Гривна — мельче рядом.
  const hero = page.locator(".hero");
  await expect(hero.locator(".gauge-main dd")).toContainText(nb("164 $"));
  await expect(hero.locator(".gauge-main .money-second")).toHaveText(nb("6 825 ₴"));
  await expect(hero).toContainText(nb("116 $"));
  await expect(hero).toContainText(nb("48 $"));

  await openTab(page, "Обслуживание");
  const record = page.locator(".rec").first();
  await expect(record).toContainText(nb("100,00 €"));
  await expect(page.locator(".kv-big dd")).toContainText(nb("164 $"));
  await expect(page.locator(".kv-big .money-second")).toHaveText(nb("6 825 ₴"));
  await expect(page.locator(".month-head").first()).toContainText(nb("116 $"));

  // Запись открывается в своей валюте.
  await record.locator(".rec-main").click();
  await expect(page.getByRole("dialog").getByLabel("Валюта")).toHaveValue("EUR");
  await expect(page.getByRole("dialog").getByLabel("Сумма €")).toHaveValue("100");
  await page.getByRole("button", { name: "Закрыть" }).click();

  await openTab(page, "Заправки");
  await expect(page.locator(".rec").first()).toContainText(nb("2 000,00 ₴"));
  await expect(page.locator(".rec-meta").first()).toContainText(nb("50,00 ₴/л"));
  await expect(page.locator(".kvs")).toContainText(nb("48,19 $"));

  // После перезагрузки — то же самое: записи и курсы пришли с сервера.
  await page.reload();
  await expect(page.locator(".gauge-main dd")).toContainText(nb("164 $"));
  await expect(page.locator(".gauge-main .money-second")).toHaveText(nb("6 825 ₴"));
  await expectNoHorizontalScroll(page);
});

test.describe("подсказка про вторую валюту", () => {
  // Без сохранённых настроек: английский по умолчанию, как у нового посетителя.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("показывается раз, «No thanks» помнится до смены языка, «Choose» открывает профиль", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Create one", exact: true }).click();
    await page.getByLabel("Email").fill(`cur-${crypto.randomUUID().slice(0, 8)}@example.com`);
    await page.getByLabel("Password").fill("correct horse battery");
    await page.getByRole("button", { name: "Create garage" }).click();
    await expect(page.getByRole("heading", { name: "The garage is empty" })).toBeVisible();

    const hint = page.getByText("You can also show a second currency next to the totals.");
    await expect(hint).toBeVisible();
    await page.getByRole("button", { name: "No thanks", exact: true }).click();
    await expect(hint).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { name: "The garage is empty" })).toBeVisible();
    await expect(hint).toBeHidden();

    // Другой язык и обратно: отказ касался прежнего выбора языка.
    await page.getByRole("button", { name: /^Language/ }).click();
    await page.getByRole("menuitemradio", { name: "Українська" }).click();
    await expect(page.getByRole("heading", { name: "Гараж порожній" })).toBeVisible();
    await page.getByRole("button", { name: /^Мова/ }).click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await expect(hint).toBeVisible();

    await page.getByRole("button", { name: "Choose", exact: true }).click();
    const profile = page.getByRole("dialog");
    await expect(profile.getByRole("group", { name: "Main currency" }).getByRole("button", { name: "$ USD" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await profile.getByRole("group", { name: "Second currency" }).getByRole("button", { name: "€ EUR" }).click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(hint).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { name: "The garage is empty" })).toBeVisible();
    await expect(hint).toBeHidden();
  });
});
