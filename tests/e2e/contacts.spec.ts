import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { addCar, expectNoHorizontalScroll, openTab, register } from "./helpers";

/** Контакти: записник корисних людей для машини, файл .vcf і посилання на один контакт. */

test("контакт: добавить, поделиться ссылкой, открыть без входа, выключить ссылку", async ({ page, browser }) => {
  const { email } = await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Контакты");
  await expect(page.getByRole("heading", { name: "Контактов пока нет" })).toBeVisible();

  await page.getByRole("button", { name: "Добавить контакт" }).click();
  const form = page.getByRole("dialog", { name: "Новый контакт" });
  await form.getByLabel("Имя или название").fill("Иван <механик>");
  await form.getByLabel("Чем занимается").fill("Ходовая, развал");
  await form.getByLabel("Телефон").fill("+380 67 123 45 67");
  await form.getByLabel("Почта").fill("ivan@example.com");
  await form.getByLabel("Сайт или Telegram").fill("@ivan_mech");
  await form.getByLabel("Заметка").fill("Пн–Пт до 18:00");
  await form.getByRole("button", { name: "Сохранить" }).click();

  const card = page.locator(".contact");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".contact-name")).toHaveText("Иван <механик>");
  await expect(card.getByRole("link", { name: "+380 67 123 45 67" })).toHaveAttribute("href", "tel:+380671234567");
  await expect(card.getByRole("link", { name: "ivan@example.com" })).toHaveAttribute("href", "mailto:ivan@example.com");
  await expect(card.getByRole("link", { name: "t.me/ivan_mech" })).toHaveAttribute("href", "https://t.me/ivan_mech");

  // Файл для телефона прямо из карточки.
  const saving = page.waitForEvent("download");
  await card.getByRole("button", { name: "Сохранить в телефон" }).click();
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe("Иван механик.vcf");
  const vcf = await readFile(await saved.path(), "utf8");
  expect(vcf).toContain("FN:Иван <механик>\r\n");
  expect(vcf).toContain("TEL;TYPE=CELL:+380 67 123 45 67\r\n");

  // Ссылка: создаётся на сервере сразу после того, как контакт туда дошёл.
  await card.getByRole("button", { name: "Поделиться" }).click();
  const share = page.getByRole("dialog", { name: "Поделиться контактом" });
  await expect(share).toContainText("Делись чужими данными только с согласия этого человека.");
  await share.getByRole("button", { name: "Создать ссылку" }).click();
  const field = share.getByLabel("Ссылка");
  await expect(field).toHaveValue(/^http:\/\/localhost:\d+\/c\/[A-Za-z0-9_-]{24}$/);
  const url = await field.inputValue();
  await share.getByRole("button", { name: "Готово" }).click();
  await expect(card.locator(".tag-share")).toHaveText("по ссылке");

  // Чужой браузер без входа видит только этот контакт.
  const stranger = await browser.newContext({ locale: "ru-RU" });
  const other = await stranger.newPage();
  const opened = await other.goto(url);
  expect(opened?.status()).toBe(200);
  expect(opened?.headers()["x-robots-tag"]).toContain("noindex");
  expect(opened?.headers()["cache-control"]).toBe("no-store");
  await expect(other.getByRole("heading", { level: 1 })).toHaveText("Иван <механик>");
  await expect(other.getByText("Ходовая, развал")).toBeVisible();
  await expect(other.getByRole("link", { name: "+380 67 123 45 67" })).toHaveAttribute("href", "tel:+380671234567");
  await expect(other.getByRole("link", { name: "t.me/ivan_mech" })).toHaveAttribute("href", "https://t.me/ivan_mech");
  await expect(other.locator("body")).not.toContainText(email);
  await expect(other.locator("body")).not.toContainText("Тест");
  const fromLink = other.waitForEvent("download");
  await other.getByRole("link", { name: "Сохранить в телефон" }).click();
  expect(await readFile(await (await fromLink).path(), "utf8")).toContain("NOTE:Пн–Пт до 18:00\r\n");

  // Владелец выключает ссылку: она сразу перестаёт открываться.
  await card.getByRole("button", { name: "Поделиться" }).click();
  await share.getByRole("button", { name: "Выключить ссылку" }).click();
  await expect(share.getByRole("button", { name: "Создать ссылку" })).toBeVisible();
  await share.getByRole("button", { name: "Готово" }).click();
  await expect(card.locator(".tag-share")).toHaveCount(0);

  const gone = await other.goto(url);
  expect(gone?.status()).toBe(404);
  await expect(other.getByRole("heading", { level: 1 })).toHaveText("Ссылка недоступна");
  await expect(other.locator("body")).not.toContainText("Иван");
  await stranger.close();
});

test("ссылка, выданная раньше, после перезагрузки не показывается: можно выдать новую", async ({ page, browser }) => {
  await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Контакты");
  await page.getByRole("button", { name: "Добавить контакт" }).click();
  await page.getByRole("dialog").getByLabel("Имя или название").fill("Шиномонтаж");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();

  await page.locator(".contact").getByRole("button", { name: "Поделиться" }).click();
  const share = page.getByRole("dialog", { name: "Поделиться контактом" });
  await share.getByRole("button", { name: "Создать ссылку" }).click();
  const first = await share.getByLabel("Ссылка").inputValue();
  await share.getByRole("button", { name: "Готово" }).click();

  await page.reload();
  await openTab(page, "Контакты");
  await page.locator(".contact").getByRole("button", { name: "Поделиться" }).click();
  await expect(share).toContainText("Ссылка включена. Сайт хранит только её отпечаток");
  await share.getByRole("button", { name: "Новая ссылка" }).click();
  const second = await share.getByLabel("Ссылка").inputValue();
  expect(second).not.toBe(first);

  const stranger = await browser.newContext({ locale: "ru-RU" });
  const other = await stranger.newPage();
  expect((await other.goto(first))?.status()).toBe(404);
  expect((await other.goto(second))?.status()).toBe(200);
  await stranger.close();
});

test("контакт из телефона: кнопка есть только там, где браузер умеет выбирать контакты", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Контакты");
  await expect(page.getByRole("button", { name: "Добавить контакт" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Из контактов телефона" })).toHaveCount(0);

  // Так выглядит Contact Picker API в Chrome на Android.
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).ContactsManager = class {};
    Object.defineProperty(navigator, "contacts", {
      value: { select: async () => [{ name: ["Сергей"], tel: ["домашний", "+380 50 111 22 33"], email: [] }] },
    });
  });
  await page.reload();
  await openTab(page, "Контакты");
  await page.getByRole("button", { name: "Из контактов телефона" }).click();
  const form = page.getByRole("dialog", { name: "Новый контакт" });
  await expect(form.getByLabel("Имя или название")).toHaveValue("Сергей");
  await expect(form.getByLabel("Телефон")).toHaveValue("+380 50 111 22 33");
  await form.getByLabel("Чем занимается").fill("Шиномонтаж");
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.locator(".contact")).toContainText("Шиномонтаж");
});

test("длинные контакты не ломают вёрстку на телефоне, удаление спрашивает подтверждение", async ({ page }) => {
  await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Контакты");
  await page.getByRole("button", { name: "Добавить контакт" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Имя или название").fill("Очень длинное название автосервиса без пробелов".repeat(2));
  await form.getByLabel("Почта").fill(`${"verylongmailbox".repeat(5)}@example.com`);
  await form.getByLabel("Сайт или Telegram").fill(`example.com/${"path".repeat(40)}`);
  await form.getByLabel("Заметка").fill("слово".repeat(60));
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.locator(".contact")).toHaveCount(1);

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalScroll(page);
  }

  // Неверный телефон форма не пропускает.
  await page.locator(".contact").getByRole("button", { name: "Изменить" }).click();
  await page.getByRole("dialog").getByLabel("Телефон").fill("позвони Ивану");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("alert")).toHaveText("Телефон: только цифры, пробелы, +, - и скобки.");
  await page.getByRole("dialog").getByRole("button", { name: "Отмена" }).click();

  await page.locator(".contact").getByRole("button", { name: "Удалить" }).click();
  await page.locator(".contact").getByRole("button", { name: "Да, удалить" }).click();
  await expect(page.getByRole("heading", { name: "Контактов пока нет" })).toBeVisible();
  await page.reload();
  await openTab(page, "Контакты");
  await expect(page.getByRole("heading", { name: "Контактов пока нет" })).toBeVisible();
});
