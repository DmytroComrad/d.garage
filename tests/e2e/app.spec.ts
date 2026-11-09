import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
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

  test("3: своё «через сколько» рядом с пресетами считает пробег само", async ({ page }) => {
    await register(page);
    await addCar(page, "Тест");
    await addFuel(page, { odo: "120000", liters: "40", sum: "2000" });
    await openTab(page, "Напоминания");
    await page.getByRole("button", { name: "Добавить напоминание" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Что нужно сделать или заменить").fill("Замена масла");

    // Пресеты остались.
    await form.getByRole("button", { name: nb("через 5 000 км") }).click();
    await expect(form.getByLabel("На пробеге, км")).toHaveValue("125000");
    await expect(form.getByLabel("Через сколько напомнить, км")).toHaveValue("5000");

    await form.getByLabel("Через сколько напомнить, км").fill("6500");
    await expect(form.getByLabel("На пробеге, км")).toHaveValue("126500");
    await expect(form.getByRole("button", { name: nb("через 5 000 км") })).not.toHaveClass(/is-on/);
    await form.getByLabel("На пробеге, км").fill("127000");
    await expect(form.getByLabel("Через сколько напомнить, км")).toHaveValue("7000");
    await form.getByLabel("Через сколько напомнить, км").fill("6500");
    await form.getByRole("button", { name: "Сохранить" }).click();

    await expect(page.locator(".rem")).toContainText("Замена масла");
    await expect(page.locator(".rem-when")).toContainText(nb("Через 6 500 км"));
  });

  test("4: бэкап в .txt, восстановление из файла, повтор без дублей", async ({ page }) => {
    await register(page);
    await loadDemo(page);
    await openTab(page, "Данные");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Скачать весь гараж" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`d-garage-backup-${today()}.txt`);
    const path = await download.path();
    const text = await readFile(path, "utf8");
    expect(JSON.parse(text).app).toBe("d-garage");

    await page.getByLabel("Файл бэкапа").setInputFiles({ name: "backup.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
    await expect(page.getByRole("status").filter({ hasText: "Загружено" })).toHaveText("Загружено: добавлено 0, уже были — 7");

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
    await expect(other.getByRole("status").filter({ hasText: "Загружено" })).toHaveText("Загружено: добавлено 7, уже были — 0");
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
    expect(book.worksheets.map((s) => s.name)).toEqual(["Сводка", "Обслуживание", "Позиции", "Заправки", "Напоминания", "Хотелки"]);

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

test("штраф записывается отдельной категорией и виден в статистике", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await page.getByRole("button", { name: "+ Сервис" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Штрафы", exact: true }).click();
  await dialog.getByLabel("Что сделано / куплено").fill("Превышение скорости");
  await dialog.getByLabel("Сумма ₴").fill("340");
  await dialog.getByRole("button", { name: "Сохранить" }).click();

  const rec = page.locator(".rec").first();
  await expect(rec.locator(".tag")).toHaveText("Штрафы");
  await openTab(page, "Статистика");
  await expect(page.locator(".tab-panel")).toContainText("Штрафы");
});

test("галерея работает без Google: фото сжимается с миниатюрой, открывается и удаляется", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Галерея");
  await expect(page.getByRole("heading", { name: "Фото пока нет" })).toBeVisible();

  // Настоящая картинка 1×1: браузер должен её прочитать, пересжать в JPEG и сделать миниатюру.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const upload = page.waitForResponse((r) => r.url().endsWith("/api/photos") && r.request().method() === "POST");
  await page.locator('input[type="file"]').setInputFiles({ name: "машина.png", mimeType: "image/png", buffer: png });
  const res = await upload;
  expect(res.status()).toBe(200);
  const { photo } = await res.json();
  expect(photo).toMatchObject({ mime: "image/jpeg", name: "машина.jpg", storage: "r2", width: 1, height: 1 });
  const thumb = await page.request.get(`/api/photos/${photo.id}/thumb`);
  expect(thumb.headers()["content-type"]).toBe("image/jpeg");

  const tile = page.locator(".photo-tile img");
  await expect(tile).toHaveCount(1);
  await expect.poll(() => tile.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await page.locator(".photo-tile").click();
  await expect.poll(() => page.locator(".lightbox-stage img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("button", { name: "Да, удалить" }).click();
  await expect(page.getByRole("heading", { name: "Фото пока нет" })).toBeVisible();

  await page.reload();
  await openTab(page, "Галерея");
  await expect(page.getByRole("heading", { name: "Фото пока нет" })).toBeVisible();
});

test("ни одна вкладка не скроллится по горизонтали", async ({ page }) => {
  await register(page);
  await loadDemo(page);
  for (const width of [320, 360, 390, 768, 900, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const tab of ["Обслуживание", "Заправки", "Напоминания", "Хотелки", "Галерея", "Статистика", "Данные"]) {
      await openTab(page, tab);
      await expectNoHorizontalScroll(page);
    }
  }
});

test("смуга вкладок на телефоні гортається лише вбік і не «плаває» вгору-вниз", async ({ page, isMobile }) => {
  test.skip(!isMobile, "дотики пальцем є лише в мобільному профілі");
  await register(page);
  await loadDemo(page);
  const tabs = page.locator(".tabs");
  const box = await tabs.boundingBox();
  if (!box) throw new Error("немає смуги вкладок");

  // Справжні дотики, як пальцем: від середини смуги на (dx, dy).
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (dx: number, dy: number) => {
    const x = box.x + box.width * 0.7;
    const y = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return tabs.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
  };

  // Навскіс: смуга їде вбік, а вертикально стоїть на місці.
  const diagonal = await swipe(-120, -60);
  expect(diagonal.left).toBeGreaterThan(0);
  expect(diagonal.top).toBe(0);

  // Вертикальний рух по смузі гортає сторінку, а не саму смугу.
  const before = await page.evaluate(() => window.scrollY);
  expect((await swipe(0, -40)).top).toBe(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
});

test("все фото можно скачать одним архивом, разложенными по папкам", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Данные");
  await expect(page.getByText("Фото пока нет.")).toBeVisible();

  await openTab(page, "Галерея");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.locator('input[type="file"]').setInputFiles({ name: "машина.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".photo-tile")).toHaveCount(1);

  await openTab(page, "Данные");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать все фото" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`d-garage-photos-${today()}.zip`);
  const zip = unzipSync(new Uint8Array(await readFile(await file.path())));
  const names = Object.keys(zip);
  expect(names).toEqual([`Тест/Галерея/${today()} машина.jpg`]);
  expect([...zip[names[0]].slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  await expect(page.getByText("Фото в архиве: 1")).toBeVisible();
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
  // Мову лишаємо: перевірка не про неї.
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("garage-ui", '{"lang":"ru"}');
  });
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
  // Мову лишаємо: перевірка не про неї.
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("garage-ui", '{"lang":"ru"}');
  });
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

test("галочки видно і в темній темі: поставлена залита кольором, порожня має чітку рамку", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await register(page);
  await addCar(page, "Тест");
  await page.getByRole("button", { name: "+ Заправка" }).first().click();
  const box = page.getByRole("dialog").getByLabel(/Полный бак/);
  await expect(box).toBeChecked();

  // Контраст за WCAG між двома кольорами rgb(...): для елементів інтерфейсу потрібно щонайменше 3.
  const contrast = (a: string, b: string): number => {
    const lum = (c: string) => {
      const [r, g, bl] = (c.match(/\d+/g) ?? []).slice(0, 3).map((v) => {
        const s = Number(v) / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const look = () =>
    box.evaluate((el) => {
      const s = getComputedStyle(el);
      const surface = getComputedStyle(el.closest(".modal") ?? document.body).backgroundColor;
      return { bg: s.backgroundColor, border: s.borderTopColor, surface };
    });

  const on = await look();
  expect(contrast(on.bg, on.surface)).toBeGreaterThanOrEqual(3);
  await box.uncheck();
  const off = await look();
  expect(off.bg).not.toBe(on.bg);
  expect(contrast(off.border, off.surface)).toBeGreaterThanOrEqual(3);
});
