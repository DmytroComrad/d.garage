import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { addCar, addFuel, expectNoHorizontalScroll, loadDemo, nb, openTab, register, today } from "./helpers";

test.describe("критерии приёмки", () => {
  test("демо-данные считаются как в спецификации", async ({ page }) => {
    await register(page);
    await loadDemo(page);

    const hero = page.locator(".hero");
    await expect(hero).toContainText(nb("Учёт с 17.08.2026 · проехано 570 км"));
    await expect(hero.locator(".gauge-main dd")).toHaveText(nb("27 093 ₴"));
    await expect(hero).toContainText(nb("21 520 ₴"));
    await expect(hero).toContainText(nb("7,8 л/100"));
    await expect(hero).toContainText(nb("47,53 ₴"));
    await expect(page.getByRole("img", { name: nb("Пробег 328 030 км") })).toBeVisible();

    await expect(page.locator(".bars")).toContainText(nb("17 215 ₴ · 80%"));
    await expect(page.locator(".bars")).toContainText(nb("4 305 ₴ · 20%"));

    await openTab(page, "Заправки");
    const side = page.locator(".side");
    await expect(side).toContainText(nb("7,8 л/100"));
    await expect(side).toContainText(nb("6,11 ₴"));
    await expect(page.locator(".rec-meta").first()).toContainText(nb("77,90 ₴/л"));
    await expect(page.locator(".rec-meta").first()).toContainText(nb("+431 км"));
    await expect(page.locator(".chip-use")).toHaveCount(1);
  });

  test("неполный бак: 8,8 и средняя 8,4", async ({ page }) => {
    await register(page);
    await loadDemo(page);
    await addFuel(page, { date: "2026-09-05", odo: "328300", liters: "20", sum: "1558", full: false });
    await addFuel(page, { date: "2026-09-10", odo: "328600", liters: "30", sum: "2337" });

    await openTab(page, "Заправки");
    await expect(page.locator(".chip-use").first()).toHaveText(nb("8,8 л/100"));
    await expect(page.getByText("не полный бак")).toBeVisible();
    await expect(page.locator(".kv-big dd")).toHaveText(nb("8,4 л/100"));
  });

  test("две машины в разном регистре создать нельзя, расход у каждой свой", async ({ page }) => {
    await register(page);
    await addCar(page, "Пассат");
    await page.getByRole("button", { name: "+ машина" }).click();
    await page.getByLabel("Как называешь машину").fill("ПАССАТ");
    await page.getByRole("dialog").getByRole("button", { name: "Добавить машину" }).click();
    await expect(page.getByRole("alert")).toHaveText("Такая машина уже есть.");
    await page.getByRole("button", { name: "Отмена" }).click();

    await addFuel(page, { odo: "1000", liters: "40", sum: "2000" });
    await addFuel(page, { odo: "1500", liters: "40", sum: "2000" });
    await expect(page.locator(".gauges")).toContainText(nb("8,0 л/100"));

    await addCar(page, "Рабочая");
    await expect(page.locator(".gauges")).not.toContainText("л/100");
    await addFuel(page, { odo: "5000", liters: "30", sum: "1500" });
    await addFuel(page, { odo: "5500", liters: "25", sum: "1250" });
    await expect(page.locator(".gauges")).toContainText(nb("5,0 л/100"));

    await page.getByRole("button", { name: "Пассат", exact: true }).click();
    await expect(page.locator(".gauges")).toContainText(nb("8,0 л/100"));
  });

  test("ошибки формы заправки дословно из ТЗ", async ({ page }) => {
    await register(page);
    await addCar(page, "Тест");
    await page.getByRole("button", { name: "+ Заправка" }).click();
    const dialog = page.getByRole("dialog");
    const save = dialog.getByRole("button", { name: "Сохранить" });
    await save.click();
    await expect(dialog.getByRole("alert")).toHaveText("Для заправки нужен пробег — без него не посчитать расход.");
    await dialog.getByLabel("Пробег, км").fill("abc");
    await save.click();
    await expect(dialog.getByRole("alert")).toHaveText("Пробег — только цифры.");
    await dialog.getByLabel("Пробег, км").fill("1000");
    await save.click();
    await expect(dialog.getByRole("alert")).toHaveText("Укажи литры.");
    await dialog.getByLabel("Литры").fill("30");
    await save.click();
    await expect(dialog.getByRole("alert")).toHaveText("Укажи сумму с чека.");
    await dialog.getByLabel("Сумма ₴").fill("2337");
    await expect(dialog).toContainText(nb("≈ 77,90 ₴/л"));
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("доработки: затраты, таблица, напоминания, бэкап, аккаунты", () => {
  test("1: затраты можно расписать на любое число строк", async ({ page }) => {
    await register(page);
    await addCar(page, "Тест");
    await page.getByRole("button", { name: "+ Сервис" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Что сделано / куплено").fill("Поездка на СТО");

    await dialog.getByRole("button", { name: "запчасти", exact: true }).click();
    await dialog.getByLabel("Название").nth(0).fill("Масло и фильтр");
    await dialog.getByLabel("Сумма, ₴").nth(0).fill("5000");
    await dialog.getByRole("button", { name: "работа", exact: true }).click();
    await dialog.getByLabel("Сумма, ₴").nth(1).fill("3000");
    await dialog.getByRole("button", { name: "другое", exact: true }).click();
    await dialog.getByLabel("Сумма, ₴").nth(2).fill("1000");
    await expect(dialog.locator(".sum-total")).toHaveText(nb("9 000,00 ₴"));
    await dialog.getByRole("button", { name: "Сохранить" }).click();

    const rec = page.locator(".rec").first();
    await expect(rec).toContainText(nb("9 000,00 ₴"));
    await expect(rec).toContainText(nb("Запчасти 5 000 ₴"));
    await expect(rec).toContainText(nb("Работа 3 000 ₴"));
    await rec.getByRole("button", { name: "Подробнее" }).click();
    await expect(rec).toContainText("Масло и фильтр");

    await openTab(page, "Статистика");
    await expect(page.getByRole("heading", { name: "Запчасти и работа" })).toBeVisible();

    await page.reload();
    await openTab(page, "Обслуживание");
    await expect(page.locator(".rec").first()).toContainText(nb("Запчасти 5 000 ₴"));
  });

  test("3: напоминания за 1000 км, за 500 км и в срок", async ({ page }) => {
    await register(page);
    await addCar(page, "Тест");

    await page.getByRole("button", { name: "+ Сервис" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Пробег, км").fill("100000");
    await form.getByLabel("Что сделано / куплено").fill("Замена масла");
    await form.getByLabel("Сумма ₴").fill("1500");
    await form.getByLabel("Напомнить через…").check();
    await form.getByLabel("Что нужно сделать или заменить").fill("Замена масла");
    await form.getByLabel("Через, км").fill("10000");
    await expect(form).toContainText(nb("На пробеге 110 000 км"));
    await form.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();

    // Далеко до срока: тихо.
    await addFuel(page, { odo: "105000", liters: "40", sum: "2000" });
    await expect(page.getByRole("alertdialog")).toBeHidden();

    // За 1000 км: окно один раз.
    await addFuel(page, { odo: "109100", liters: "40", sum: "2000" });
    const alert = page.getByRole("alertdialog");
    await expect(alert).toContainText(nb("Через 900 км — замена масла"));
    await alert.getByRole("button", { name: "Понятно" }).click();
    await expect(alert).toBeHidden();
    await expect(page.locator(".lamps")).toContainText(nb("Через 900 км — замена масла"));

    await addFuel(page, { odo: "109300", liters: "40", sum: "2000" });
    await expect(page.getByRole("alertdialog")).toBeHidden();

    // За 500 км: снова окно, запись на мойке тоже считается.
    await page.getByRole("button", { name: "+ Сервис" }).first().click();
    const wash = page.getByRole("dialog");
    await wash.getByLabel("Пробег, км").fill("109600");
    await wash.getByLabel("Что сделано / куплено").fill("Мойка");
    await wash.getByLabel("Сумма ₴").fill("300");
    await wash.getByRole("button", { name: "Сохранить" }).click();
    await expect(alert).toContainText(nb("Через 400 км — замена масла"));
    await alert.getByRole("button", { name: "Понятно" }).click();

    // Срок прошёл: окно при каждой новой записи, пока не отмечено «Сделано».
    await addFuel(page, { odo: "110100", liters: "40", sum: "2000" });
    await expect(alert).toContainText(nb("Просрочено на 100 км — замена масла"));
    await alert.getByRole("button", { name: "Понятно" }).click();
    await addFuel(page, { odo: "110200", liters: "40", sum: "2000" });
    await expect(alert).toContainText(nb("Просрочено на 200 км"));
    await alert.getByRole("button", { name: "Сделано" }).click();
    await alert.getByRole("button", { name: "Понятно" }).click();
    await expect(page.locator(".lamps")).toBeHidden();

    await openTab(page, "Напоминания");
    await expect(page.getByText("Сделано: 1")).toBeVisible();
  });

  test("3: напоминание по дате и отдельное напоминание", async ({ page }) => {
    await register(page);
    await addCar(page, "Тест");
    await addFuel(page, { odo: "1000", liters: "40", sum: "2000" });
    await openTab(page, "Напоминания");
    await page.getByRole("button", { name: "Добавить напоминание" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Что нужно сделать или заменить").fill("Страховка");
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await form.getByLabel("Или к дате").fill(soon);
    await form.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator(".rem")).toContainText("Страховка");
    await expect(page.locator(".rem-when")).toContainText(/Через\s+\d+\s+дн/);
    await expect(page.getByRole("tab", { name: /Напоминания/ }).locator(".tab-badge")).toHaveText("1");
  });

  test("4: бэкап в .txt, восстановление из файла, повтор без дублей", async ({ page }) => {
    await register(page);
    await loadDemo(page);
    await openTab(page, "Данные");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Скачать весь гараж" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`garage-backup-${today()}.txt`);
    const path = await download.path();
    const text = await readFile(path, "utf8");
    expect(JSON.parse(text).app).toBe("garage-amedro");

    await page.getByLabel("Файл бэкапа").setInputFiles({ name: "backup.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
    await expect(page.getByRole("status").filter({ hasText: "Загружено" })).toHaveText("Загружено: добавлено 0, уже были — 5");

    await page.getByRole("button", { name: "Стереть все данные" }).click();
    await page.getByRole("button", { name: "Да, стереть" }).click();
    await expect(page.getByRole("heading", { name: "Гараж пуст" })).toBeVisible();
  });

  test("4: восстановление в новый аккаунт и ошибки", async ({ page, browser }) => {
    await register(page);
    await loadDemo(page);
    await openTab(page, "Данные");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Скачать весь гараж" }).click(),
    ]);
    const text = await readFile(await download.path(), "utf8");

    const context = await browser.newContext({ locale: "ru-RU" });
    const other = await context.newPage();
    await register(other);
    await other.getByRole("button", { name: "Добавить машину" }).click();
    await other.getByLabel("Как называешь машину").fill("Моя");
    await other.getByRole("dialog").getByRole("button", { name: "Добавить машину" }).click();
    await openTab(other, "Данные");

    const area = other.getByLabel("Или вставь текст бэкапа");
    await area.fill("{обрезано");
    await other.getByRole("button", { name: "Загрузить" }).click();
    await expect(other.getByRole("alert")).toHaveText("Не получилось прочитать бэкап — текст обрезан или повреждён.");
    await area.fill('{"a":1}');
    await other.getByRole("button", { name: "Загрузить" }).click();
    await expect(other.getByRole("alert")).toHaveText("Это не похоже на бэкап гаража.");

    await area.fill(text);
    await other.getByRole("button", { name: "Загрузить" }).click();
    await expect(other.getByRole("status").filter({ hasText: "Загружено" })).toHaveText("Загружено: добавлено 5, уже были — 0");
    await other.reload();
    await other.getByRole("button", { name: "Демо-машина", exact: true }).click();
    await expect(other.locator(".gauge-main dd")).toHaveText(nb("27 093 ₴"));
    await context.close();
  });

  test("2: таблица .xlsx совпадает с сайтом, без 918 л/100", async ({ page }) => {
    await register(page);
    await loadDemo(page);
    await openTab(page, "Данные");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Скачать таблицу .xlsx" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(await download.path());
    expect(book.worksheets.map((s) => s.name)).toEqual(["Сводка", "Обслуживание", "Позиции", "Заправки", "Напоминания"]);

    const value = (sheet: string, column: string, row = 2) => {
      const ws = book.getWorksheet(sheet);
      if (!ws) throw new Error(sheet);
      const header = ws.getRow(1).values as unknown[];
      return ws.getRow(row).getCell(header.indexOf(column)).value;
    };
    expect(value("Сводка", "Вложено всего, ₴")).toBe(27092.97);
    expect(value("Сводка", "Обслуживание, ₴")).toBe(21520);
    expect(value("Сводка", "Топливо, ₴")).toBe(5572.97);
    expect(value("Сводка", "Средний расход, л/100")).toBe(7.84);
    expect(value("Заправки", "Литры", 2)).toBe(37.74);
    expect(value("Заправки", "Расход, л/100", 3)).toBe(7.84);
  });

  test("6: профиль открывается на другом устройстве, чужой гараж не виден", async ({ page, browser }) => {
    const { email, password } = await register(page);
    await loadDemo(page);
    await expect(page.locator(".gauge-main dd")).toHaveText(nb("27 093 ₴"));
    await page.waitForLoadState("networkidle");

    const device = await browser.newContext({ locale: "ru-RU" });
    const phone = await device.newPage();
    await phone.goto("/");
    await phone.getByLabel("Почта").fill(email);
    await phone.getByLabel("Пароль").fill(password);
    await phone.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(phone.locator(".gauge-main dd")).toHaveText(nb("27 093 ₴"));

    await phone.getByRole("button", { name: /Профиль/ }).click();
    await phone.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(phone.getByRole("heading", { name: "Вход" })).toBeVisible();

    await register(phone);
    await expect(phone.getByRole("heading", { name: "Гараж пуст" })).toBeVisible();
    await device.close();
  });

  test("вход с неверным паролем показывает понятную ошибку", async ({ page, browser }) => {
    const { email } = await register(page);
    const context = await browser.newContext({ locale: "ru-RU" });
    const other = await context.newPage();
    await other.goto("/");
    await other.getByLabel("Почта").fill(email);
    await other.getByLabel("Пароль").fill("wrong password");
    await other.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(other.getByRole("alert")).toHaveText("Неверная почта или пароль.");
    await context.close();
  });
});

test("без сети запись сохраняется и уходит на сервер, когда связь вернулась", async ({ page, context }) => {
  await register(page);
  await addCar(page, "Тест");
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  await addFuel(page, { odo: "1000", liters: "40", sum: "2000", station: "Офлайн" });
  await expect(page.locator(".rec, .gauges").first()).toBeVisible();
  await expect(page.getByText("Нет связи с сервером.")).toBeVisible();
  await expect(page.getByText(/Несохранённых изменений: 1/)).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("Нет связи с сервером.")).toBeHidden();
  await page.reload();
  await openTab(page, "Заправки");
  await expect(page.locator(".rec-title").first()).toHaveText("Офлайн");
});

test("кнопка «назад» закрывает окно, а не уводит с сайта", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await page.getByRole("button", { name: "+ Заправка" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Тест" })).toBeVisible();
});

test("Галерея без настроенного Google говорит об этом, а не падает", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Галерея");
  await expect(page.getByRole("heading", { name: "Галерея пока недоступна" })).toBeVisible();
});

test("ни одна вкладка не скроллится по горизонтали", async ({ page }) => {
  await register(page);
  await loadDemo(page);
  for (const width of [320, 360, 390, 768, 900, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const tab of ["Обслуживание", "Заправки", "Напоминания", "Галерея", "Статистика", "Данные"]) {
      await openTab(page, tab);
      await expectNoHorizontalScroll(page);
    }
  }
});

test("после ошибки регистрации проверка на робота выдаётся заново", async ({ page }) => {
  // Заглушка Turnstile: настоящий виджет не пропускает автоматический браузер.
  await page.addInitScript(() => {
    const w = window as unknown as { __renders: number; turnstile: unknown };
    w.__renders = 0;
    w.turnstile = {
      render: (_el: unknown, opts: { callback: (t: string) => void }) => {
        w.__renders++;
        setTimeout(() => opts.callback(`token-${w.__renders}`), 0);
        return "widget";
      },
      remove: () => undefined,
    };
  });
  await page.route("**/api/config", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), turnstileSiteKey: "test-key" } });
  });

  const { email, password } = await register(page);
  await page.getByRole("button", { name: /Профиль/ }).click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.getByRole("button", { name: "Создать", exact: true }).click();

  await page.getByLabel("Почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Создать гараж" }).click();
  await expect(page.getByRole("alert")).toContainText("уже зарегистрирована");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __renders: number }).__renders)).toBeGreaterThan(1);

  await page.getByLabel("Почта").fill(`e2e-${crypto.randomUUID().slice(0, 12)}@example.com`);
  await page.getByRole("button", { name: "Создать гараж" }).click();
  await expect(page.getByRole("heading", { name: "Гараж пуст" })).toBeVisible();
});

test("незбережені записи переживають кінець сесії й доходять після входу", async ({ page, context }) => {
  const { email, password } = await register(page);
  await addCar(page, "Тест");
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  await addFuel(page, { odo: "1000", liters: "40", sum: "2000", station: "После сессии" });
  await expect(page.getByText(/Несохранённых изменений: 1/)).toBeVisible();

  // Сесія закінчилась, поки пристрій був без мережі. Перезавантаження не має стерти чергу.
  await context.clearCookies();
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("heading", { name: "Вход" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Вход" }).waitFor();

  await page.getByLabel("Почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Тест" }).waitFor();
  await openTab(page, "Заправки");
  await expect(page.locator(".rec-title").first()).toHaveText("После сессии");

  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await openTab(page, "Заправки");
  await expect(page.locator(".rec-title").first()).toHaveText("После сессии");
});

test("другой аккаунт не получает чужие незбережені записи", async ({ page, context }) => {
  await register(page);
  await addCar(page, "Чужая");
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await addFuel(page, { odo: "1000", liters: "40", sum: "2000" });
  await context.clearCookies();
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("heading", { name: "Вход" }).waitFor();

  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await page.getByLabel("Почта").fill(`e2e-${crypto.randomUUID().slice(0, 12)}@example.com`);
  await page.getByLabel("Пароль").fill("correct horse battery");
  await page.getByRole("button", { name: "Создать гараж" }).click();
  await expect(page.getByRole("heading", { name: "Гараж пуст" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Гараж пуст" })).toBeVisible();
});

test("выход без интернета не теряет записи и не притворяется выходом", async ({ page, context }) => {
  await register(page);
  await addCar(page, "Тест");
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await addFuel(page, { odo: "1000", liters: "40", sum: "2000", station: "Без сети" });

  await page.getByRole("button", { name: /Профиль/ }).click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page.getByText(/Выйти можно, когда появится интернет/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Вход" })).toBeHidden();
  await page.keyboard.press("Escape");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("Нет связи с сервером.")).toBeHidden();
  await page.reload();
  await openTab(page, "Заправки");
  await expect(page.locator(".rec-title").first()).toHaveText("Без сети");
});

test("ссылка сброса пароля видна и тому, кто уже вошёл, а отмена возвращает в гараж", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await page.goto("/?reset=not-a-real-token-but-long-enough");
  await expect(page.getByRole("heading", { name: "Новый пароль" })).toBeVisible();
  expect(page.url()).not.toContain("reset=");

  await page.getByRole("textbox", { name: /Пароль/ }).fill("brand new password");
  await page.getByRole("button", { name: "Сохранить пароль" }).click();
  await expect(page.getByRole("alert")).toHaveText("Ссылка устарела. Запроси новую.");

  await page.getByRole("button", { name: "Вернуться ко входу" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Тест" })).toBeVisible();
});

test("тема: тёмная по системе, выбор в профиле важнее и переживает перезагрузку", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await register(page);
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await theme()).toBe("dark");
  expect(await bg()).toBe("rgb(13, 16, 21)");

  await page.getByRole("button", { name: /Профиль/ }).click();
  await page.getByRole("button", { name: "Светлая" }).click();
  expect(await theme()).toBe("light");
  expect(await bg()).toBe("rgb(238, 241, 245)");

  await page.reload();
  await page.getByRole("heading", { name: "Гараж пуст" }).waitFor();
  expect(await theme()).toBe("light");

  await page.getByRole("button", { name: /Профиль/ }).click();
  await page.getByRole("button", { name: "Как в системе" }).click();
  expect(await theme()).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(theme).toBe("light");
});
