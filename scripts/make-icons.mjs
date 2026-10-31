// Генерує PNG-іконки з public/icon.svg. Запуск: node scripts/make-icons.mjs
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const svg = await readFile("public/icon.svg", "utf8");
const browser = await chromium.launch();
for (const [name, size, maskable] of [
  ["icon-180", 180, false],
  ["icon-192", 192, false],
  ["icon-512", 512, false],
  ["icon-maskable-512", 512, true],
]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = maskable ? "transform:scale(.78);" : "";
  await page.setContent(
    `<html><body style="margin:0;background:${maskable ? "#0D1015" : "transparent"}"><div style="width:${size}px;height:${size}px;${inner}">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: `public/${name}.png`, omitBackground: !maskable });
  await page.close();
}
await browser.close();
