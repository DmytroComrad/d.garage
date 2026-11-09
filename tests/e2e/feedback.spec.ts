import { expect, test, type Page } from "@playwright/test";
import { addCar, addFuel, expectNoHorizontalScroll, loadDemo, nb, openTab, register, today } from "./helpers";

/** Відгук після першого тестування: видалення записів, мови, хотілки, милі, формат дати, бекап перетягуванням. */

const openProfile = (page: Page) => page.getByRole("button", { name: /Профиль|Profile|Профіль/ }).click();

test.describe("мова", () => {
  // Без збереженої мови: так сайт бачить новий відвідувач.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("за замовчуванням англійська, вибір мови поруч із профілем і переживає перезавантаження", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    await expect(page.locator(".brand")).toHaveText("D.Garage");

    await page.getByRole("button", { name: "Create one", exact: true }).click();
    await page.getByLabel("Email").fill(`lang-${crypto.randomUUID().slice(0, 8)}@example.com`);
    await page.getByLabel("Password").fill("correct horse battery");
    await page.getByRole("button", { name: "Create garage" }).click();
    await expect(page.getByRole("heading", { name: "The garage is empty" })).toBeVisible();

    const menu = page.getByRole("button", { name: /^Language: English/ });
    await menu.click();
    const items = page.getByRole("menuitemradio");
    await expect(items).toHaveText(["English", "Українська", "рузкій язичок"]);
    await page.getByRole("menuitemradio", { name: "Українська" }).click();

    await expect(page.getByRole("heading", { name: "Гараж порожній" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("uk");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Гараж порожній" })).toBeVisible();

    await page.getByRole("button", { name: "Подивитися на прикладі" }).click();
    await expect(page.getByRole("tab", { name: "Хотілки" })).toBeVisible();
    await expect(page.locator(".hero")).toContainText(nb("Облік з 17.08.2026 · проїхано 570 км"));
  });

  test("помилки сервера приходять вибраною мовою", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Language/ }).click();
    await page.getByRole("menuitemradio", { name: "Українська" }).click();
    await page.getByLabel("Пошта").fill("nobody@example.com");
    await page.getByLabel("Пароль").fill("wrong password");
    await page.getByRole("button", { name: "Увійти" }).click();
    await expect(page.getByRole("alert")).toHaveText("Неправильна пошта або пароль.");
  });
});

test("записи можна видалити кількома одразу", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await addFuel(page, { odo: "1000", liters: "40", sum: "2000" });
  await addFuel(page, { odo: "1500", liters: "40", sum: "2000" });
  await addFuel(page, { odo: "2000", liters: "40", sum: "2000" });
  await openTab(page, "Заправки");
  await expect(page.locator(".rec")).toHaveCount(3);

  await page.getByRole("button", { name: "Удалить записи" }).click();
  const rows = page.locator(".rec-main");
  await rows.nth(0).click();
  await rows.nth(1).click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Удалить (2)" }).click();
  await expect(page.getByText("Удалить 2 записи? Это не отменить.")).toBeVisible();
  await page.getByRole("button", { name: "Да, удалить" }).click();

  await expect(page.locator(".rec")).toHaveCount(1);
  await page.reload();
  await openTab(page, "Заправки");
  await expect(page.locator(".rec")).toHaveCount(1);
});

test("хотелка: галочка → запись в расходах; снятая галочка делает запись неактуальной", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Хотелки");
  await expect(page.getByRole("heading", { name: "Хотелок пока нет" })).toBeVisible();

  await page.getByRole("button", { name: "Добавить хотелку" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Что хочешь сделать или купить").fill("Зимняя резина");
  await form.getByLabel("Примерная цена, ₴").fill("14000");
  await form.getByLabel("Ссылки на товары или запчасти 1").fill("rozetka.com.ua/tires");
  await form.getByRole("button", { name: "Сохранить" }).click();

  const wish = page.locator(".wish");
  await expect(wish).toContainText(nb("≈ 14 000 ₴"));
  await expect(wish.getByRole("link", { name: "rozetka.com.ua" })).toHaveAttribute("href", "https://rozetka.com.ua/tires");
  await expect(page.locator(".wish-totals")).toContainText(nb("В планах: 1"));

  // Галочка: предлагаем записать в расходы, описание и цена подставлены.
  await wish.getByRole("checkbox").click();
  await expect(page.getByRole("dialog", { name: "Готово! Записать в расходы?" })).toBeVisible();
  await page.getByRole("button", { name: "Создать запись" }).click();
  const service = page.getByRole("dialog", { name: "Ремонт, покупка, сервис" });
  await expect(service.getByLabel("Что сделано / куплено")).toHaveValue("Зимняя резина");
  await expect(service.getByLabel("Сумма ₴")).toHaveValue("14000");
  await expect(service.getByRole("button", { name: "Запчасти / покупки" })).toHaveAttribute("aria-pressed", "true");
  await service.getByLabel("Сумма ₴").fill("13500");
  await service.getByRole("button", { name: "Сохранить" }).click();

  await expect(wish.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await expect(wish.locator(".wish-title")).toHaveCSS("text-decoration-line", "line-through");
  await expect(wish.getByRole("button", { name: "в расходах" })).toBeVisible();
  await openTab(page, "Обслуживание");
  await expect(page.locator(".rec")).toContainText(nb("13 500,00 ₴"));

  // Галочку сняли: запись в расходах становится неактуальной.
  await openTab(page, "Хотелки");
  await wish.getByRole("checkbox").click();
  await expect(wish.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("tab", { name: /Обслуживание/ }).locator(".tab-badge")).toHaveText("1");

  await openTab(page, "Обслуживание");
  const stale = page.locator(".stale");
  await expect(stale).toContainText("Неактуальные записи: 1");
  await expect(stale).toContainText("Зимняя резина");
  await expect(page.locator(".rec .tag-bad")).toHaveText("неактуально");
  await stale.getByRole("button", { name: "Удалить неактуальные (1)" }).click();
  await stale.getByRole("button", { name: "Да, удалить" }).click();
  await expect(page.locator(".stale")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ремонтов и покупок пока нет" })).toBeVisible();

  // Повторная галочка снова предлагает запись: старой больше нет.
  await openTab(page, "Хотелки");
  await expect(wish.getByRole("button", { name: "в расходах" })).toHaveCount(0);
  await wish.getByRole("checkbox").click();
  await expect(page.getByRole("dialog", { name: "Готово! Записать в расходы?" })).toBeVisible();
  await page.getByRole("button", { name: "Нет, не нужно" }).click();
  await expect(wish.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
});

test("неактуальную запись можно оставить: связь с хотелкой убирается", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Хотелки");
  await page.getByRole("button", { name: "Добавить хотелку" }).click();
  await page.getByRole("dialog").getByLabel("Что хочешь сделать или купить").fill("Тонировка");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
  await page.locator(".wish").getByRole("checkbox").click();
  await page.getByRole("button", { name: "Создать запись" }).click();
  await page.getByRole("dialog").getByLabel("Сумма ₴").fill("3000");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
  await page.locator(".wish").getByRole("checkbox").click();

  await openTab(page, "Обслуживание");
  await page.locator(".stale").getByRole("button", { name: "Оставить записи" }).click();
  await expect(page.locator(".stale")).toHaveCount(0);
  await expect(page.locator(".rec")).toHaveCount(1);
  await expect(page.locator(".rec .tag-bad")).toHaveCount(0);
});

test("мили и формат даты: показ меняется, данные остаются в километрах", async ({ page }) => {
  await register(page);
  await loadDemo(page);
  await openProfile(page);
  await page.getByRole("button", { name: "Мили" }).click();
  const [y, m, d] = today().split("-");
  await page.getByRole("button", { name: `${y}-${m}-${d}` }).click();
  await page.getByRole("button", { name: "Закрыть" }).click();

  // 570 км = 354 мили; 328 030 км = 203 828 миль; 7,84 л/100 км = 12,6 л/100 миль.
  await expect(page.locator(".hero")).toContainText(nb("Учёт с 2026-08-17 · проехано 354 мили"));
  await expect(page.getByRole("img", { name: nb("Пробег 203 828 миль") })).toBeVisible();
  await expect(page.locator(".gauges")).toContainText(nb("12,6 л/100 миль"));
  await expect(page.locator(".gauges")).toContainText("1 миля обходится");

  // Пробег вводится в милях и так же показывается.
  await page.getByRole("button", { name: "+ Заправка" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Пробег, мили").fill("204000");
  await dialog.getByLabel("Литры").fill("30");
  await dialog.getByLabel("Сумма ₴").fill("1500");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("img", { name: nb("Пробег 204 000 миль") })).toBeVisible();

  // Назад в километры: 204 000 миль = 328 306 км.
  await openProfile(page);
  await page.getByRole("button", { name: "Километры" }).click();
  await page.getByRole("button", { name: "Закрыть" }).click();
  await expect(page.getByRole("img", { name: nb("Пробег 328 306 км") })).toBeVisible();
});

test("обе единицы сразу: вторая в скобках, ввод остаётся в основной", async ({ page }) => {
  await register(page);
  await loadDemo(page);
  await openProfile(page);
  await page.getByLabel("Показывать и мили").check();
  await page.getByRole("button", { name: "Закрыть" }).click();
  await expect(page.locator(".hero")).toContainText(nb("проехано 570 км (354 мили)"));

  await page.reload();
  await expect(page.locator(".hero")).toContainText(nb("проехано 570 км (354 мили)"));
  await page.getByRole("button", { name: "+ Заправка" }).first().click();
  await expect(page.getByRole("dialog").getByLabel("Пробег, км")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Отмена" }).click();

  // Основные — мили: подпись галочки меняется, километры уходят в скобки.
  await openProfile(page);
  await page.getByRole("button", { name: "Мили", exact: true }).click();
  await expect(page.getByLabel("Показывать и километры")).toBeChecked();
  await page.getByRole("button", { name: "Закрыть" }).click();
  await expect(page.locator(".hero")).toContainText(nb("проехано 354 мили (570 км)"));

  // Строки длиннее, но вёрстка на узком телефоне не ломается.
  await page.setViewportSize({ width: 320, height: 760 });
  for (const tab of ["Обслуживание", "Заправки", "Напоминания", "Статистика"]) {
    await openTab(page, tab);
    await expectNoHorizontalScroll(page);
  }
});

test("бэкап можно перетащить файлом на карточку", async ({ page }) => {
  await register(page);
  await loadDemo(page);
  await openTab(page, "Данные");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Скачать весь гараж" }).click(),
  ]);
  const text = await (await import("node:fs/promises")).readFile(await download.path(), "utf8");

  const card = page.locator(".dropzone");
  const transfer = await page.evaluateHandle((content) => {
    const dt = new DataTransfer();
    dt.items.add(new File([content], "backup.txt", { type: "text/plain" }));
    return dt;
  }, text);
  await card.dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(page.getByText("Отпусти файл, чтобы загрузить бэкап")).toBeVisible();
  await card.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByRole("status").filter({ hasText: "Загружено" })).toHaveText("Загружено: добавлено 0, уже были — 7");
  await expect(page.getByText("Отпусти файл, чтобы загрузить бэкап")).toHaveCount(0);
});

test("пояснение о напоминаниях показывается, пока не нажмёшь «Понятно»", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Напоминания");
  const note = page.locator(".note");
  await expect(note).toContainText("Сайт не видит одометр машины");
  await expect(note).toContainText(nb("последняя запись — на 99 800 км, а замена масла — на 100 000 км"));
  await note.getByRole("button", { name: "Понятно" }).click();
  await expect(note).toHaveCount(0);

  await page.reload();
  await openTab(page, "Напоминания");
  await expect(page.locator(".note")).toHaveCount(0);
  await page.getByRole("button", { name: "Как работают напоминания?" }).click();
  await expect(page.locator(".note")).toContainText("По дате");
});

test("длинные ссылки в хотелках не ломают вёрстку на телефоне", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await page.setViewportSize({ width: 320, height: 760 });
  await openTab(page, "Хотелки");
  await page.getByRole("button", { name: "Добавить хотелку" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Что хочешь сделать или купить").fill("Очень длинное название хотелки без пробелов".repeat(3));
  await form.getByLabel("Примерная цена, ₴").fill("123456789-987654321");
  await form.getByLabel("Ссылки на товары или запчасти 1").fill(`https://very-long-shop-domain-name-${"x".repeat(60)}.com.ua/item`);
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.locator(".wish")).toHaveCount(1);
  await expectNoHorizontalScroll(page);
});

test("хотелка с ценой «от-до»: диапазон в списке и в итогах, правка показывает его же", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Хотелки");

  await page.getByRole("button", { name: "Добавить хотелку" }).click();
  let form = page.getByRole("dialog");
  await form.getByLabel("Что хочешь сделать или купить").fill("Зимняя резина");
  await form.getByLabel("Примерная цена, ₴").fill("4000-6000");
  await form.getByRole("button", { name: "Сохранить" }).click();

  await page.getByRole("button", { name: "Добавить хотелку" }).click();
  form = page.getByRole("dialog");
  await form.getByLabel("Что хочешь сделать или купить").fill("Коврики");
  await form.getByLabel("Примерная цена, ₴").fill("1000");
  await form.getByRole("button", { name: "Сохранить" }).click();

  const wishes = page.locator(".wish");
  await expect(wishes.nth(0)).toContainText(nb("≈ 4 000–6 000 ₴"));
  await expect(wishes.nth(1)).toContainText(nb("≈ 1 000 ₴"));
  await expect(page.locator(".wish-totals")).toContainText(nb("≈ 5 000–7 000 ₴"));

  // Ошибка понятная, а не «только цифры».
  await wishes.nth(0).locator(".wish-main").click();
  form = page.getByRole("dialog");
  await expect(form.getByLabel("Примерная цена, ₴")).toHaveValue("4000-6000");
  await form.getByLabel("Примерная цена, ₴").fill("4000-");
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(form.getByText("Цена — число или диапазон, например 4000-6000.")).toBeVisible();
  await form.getByLabel("Примерная цена, ₴").fill("4500 – 5500");
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(wishes.nth(0)).toContainText(nb("≈ 4 500–5 500 ₴"));

  // Выполнена: сумму с диапазоном впишут сами, описание подставлено.
  await wishes.nth(0).getByRole("checkbox").click();
  await page.getByRole("button", { name: "Создать запись" }).click();
  const service = page.getByRole("dialog", { name: "Ремонт, покупка, сервис" });
  await expect(service.getByLabel("Что сделано / куплено")).toHaveValue("Зимняя резина");
  await expect(service.getByLabel("Сумма ₴")).toHaveValue("");

  await page.reload();
  await openTab(page, "Хотелки");
  await expect(page.locator(".wish-totals")).toContainText(nb("≈ 1 000 ₴"));
});

test("журнал: фильтр по месяцу, датам и пробегу, сортировка по сумме", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await addFuel(page, { date: "2026-01-10", odo: "1000", liters: "40", sum: "2000" });
  await addFuel(page, { date: "2026-02-10", odo: "1500", liters: "40", sum: "2600" });
  await addFuel(page, { date: "2026-03-10", odo: "2000", liters: "40", sum: "1800" });
  await openTab(page, "Заправки");
  const recs = page.locator(".rec");
  await expect(recs).toHaveCount(3);

  await page.getByRole("button", { name: "Фильтр" }).click();
  const panel = page.getByRole("region", { name: "Фильтр" });
  await panel.getByLabel("Месяц").selectOption("2026-02");
  await expect(recs).toHaveCount(1);
  await expect(page.locator(".filter-result")).toContainText("Показано 1 из 3");
  await expect(page.locator(".filter-result")).toContainText(nb("2 600 ₴"));

  await panel.getByLabel("Месяц").selectOption("");
  await panel.getByLabel("Пробег от, км").fill("1200");
  await expect(recs).toHaveCount(2);
  await panel.getByLabel("Пробег до, км").fill("1800");
  await expect(recs).toHaveCount(1);
  await panel.getByLabel("Начало периода").fill("2026-03-01");
  await expect(page.getByRole("heading", { name: "Ничего не найдено" })).toBeVisible();
  await panel.getByRole("button", { name: "Сбросить" }).click();
  await expect(recs).toHaveCount(3);
  await panel.getByRole("button", { name: "Готово" }).click();
  await expect(panel).toBeHidden();

  // Сортировка рядом с фильтром: по сумме список идёт без деления на месяцы.
  await page.getByLabel("Сортировка").selectOption({ label: "Сначала дорогие" });
  await expect(page.locator(".month")).toHaveCount(0);
  await expect(page.locator(".rec-sum")).toHaveText([/2\s600/, /2\s000/, /1\s800/]);

  // Выбор переживает переход между вкладками.
  await openTab(page, "Обслуживание");
  await openTab(page, "Заправки");
  await expect(page.getByLabel("Сортировка")).toHaveValue("expensive");
  await expect(page.locator(".rec-sum").first()).toHaveText(/2\s600/);
});

test("хотелки можно отсортировать по цене и названию, выполненные остаются внизу", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Хотелки");
  for (const [title, price] of [["Шины", "14000"], ["Коврики", "900"], ["Видеорегистратор", "5000"]]) {
    await page.getByRole("button", { name: "Добавить хотелку" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Что хочешь сделать или купить").fill(title);
    await form.getByLabel("Примерная цена, ₴").fill(price);
    await form.getByRole("button", { name: "Сохранить" }).click();
  }
  const titles = page.locator(".wish-title");
  await expect(titles).toHaveText(["Шины", "Коврики", "Видеорегистратор"]);

  await page.getByLabel("Сортировка").selectOption({ label: "Сначала дорогие" });
  await expect(titles).toHaveText(["Шины", "Видеорегистратор", "Коврики"]);
  await page.getByLabel("Сортировка").selectOption({ label: "По названию" });
  await expect(titles).toHaveText(["Видеорегистратор", "Коврики", "Шины"]);

  await page.locator(".wish").filter({ hasText: "Видеорегистратор" }).getByRole("checkbox").click();
  await page.getByRole("button", { name: "Нет, не нужно" }).click();
  await expect(titles).toHaveText(["Коврики", "Шины", "Видеорегистратор"]);
});
