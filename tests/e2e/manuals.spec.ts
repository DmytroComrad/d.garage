import { expect, test } from "@playwright/test";
import { addCar, openTab, register } from "./helpers";

/** Мануали: посилання й файли для машини, обмін ними за посиланням. */

test("мануалы: ссылка и PDF, а по ссылке другой человек забирает нужное себе", async ({ page, browser }) => {
  await register(page);
  await addCar(page, "Тест");
  await openTab(page, "Мануалы");
  await expect(page.getByRole("heading", { name: "Материалов пока нет" })).toBeVisible();

  // Ссылка: название по умолчанию — сайт.
  await page.getByRole("button", { name: "Добавить материал" }).click();
  let form = page.getByRole("dialog");
  await form.getByLabel("Ссылка", { exact: true }).fill("example.com/manual");
  await form.getByRole("button", { name: "Сохранить" }).click();
  const link = page.locator(".manual").filter({ hasText: "example.com" }).getByRole("link");
  await expect(link).toHaveAttribute("href", "https://example.com/manual");
  await expect(link).toHaveAttribute("target", "_blank");

  // Файл: название берётся из имени, открывается в новой вкладке как PDF.
  await page.getByRole("button", { name: "Добавить материал" }).click();
  form = page.getByRole("dialog");
  await form.getByRole("button", { name: "Файл", exact: true }).click();
  await form.locator('input[type="file"]').setInputFiles({
    name: "Мануал.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nhello"),
  });
  await expect(form.getByLabel("Название")).toHaveValue("Мануал.pdf");
  await form.getByRole("button", { name: "Сохранить" }).click();
  const row = page.locator(".manual").filter({ hasText: "Мануал.pdf" });
  await expect(row.locator(".rec-meta")).toHaveText(/^14\s+Б$/);
  const pdf = row.getByRole("link");
  await expect(pdf).toBeVisible();
  const file = await page.request.get((await pdf.getAttribute("href")) ?? "");
  expect(file.headers()["content-type"]).toBe("application/pdf");
  expect(await file.text()).toBe("%PDF-1.7\nhello");

  // Поделиться: одна ссылка на машину.
  await page.getByRole("button", { name: "Поделиться" }).click();
  await page.getByRole("button", { name: "Создать ссылку" }).click();
  const shareUrl = await page.locator(".share-url").inputValue();
  expect(shareUrl).toContain("/?manuals=");

  // Гость приходит по ссылке без аккаунта: регистрируется, добавляет машину и открывает ссылку снова.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(shareUrl);
  await register(guest);
  await expect(guest.getByText("Сначала добавь машину, а потом открой ссылку ещё раз.")).toBeVisible();
  await guest.getByRole("button", { name: "Отмена" }).click();
  await addCar(guest, "Моя");
  await guest.goto(shareUrl);
  const dialog = guest.getByRole("dialog", { name: "Материалы для «Тест»" });
  await expect(dialog.getByRole("checkbox")).toHaveCount(2);
  await dialog.getByRole("checkbox", { name: /example\.com/ }).uncheck();
  await dialog.getByRole("button", { name: "Добавить (1)" }).click();
  await expect(guest.getByRole("tab", { name: "Мануалы" })).toHaveAttribute("aria-selected", "true");
  await expect(guest.locator(".manual")).toHaveCount(1);
  await expect(guest.locator(".manual")).toContainText("Мануал.pdf");

  // Выключенная ссылка больше не работает.
  await page.getByRole("button", { name: "Выключить ссылку" }).click();
  await guest.goto(shareUrl);
  await expect(guest.getByRole("dialog").getByRole("alert")).toContainText("Ссылка не работает");
});
