import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Прев'ю посилання в Telegram та інших месенджерах будується з цих тегів index.html. */

const html = readFileSync("index.html", "utf8");
const meta = (attr: "name" | "property", key: string): string | undefined =>
  html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1];
const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
const appUrl = readFileSync("wrangler.jsonc", "utf8").match(/"APP_URL":\s*"([^"]+)"/)?.[1];

describe("прев'ю посилання", () => {
  it("назва й опис ті самі, що й у сторінки, і без старої назви", () => {
    expect(title).toMatch(/^D\.Garage/);
    expect(meta("property", "og:site_name")).toBe("D.Garage");
    expect(meta("property", "og:title")).toBe(title);
    expect(meta("property", "og:description")).toBe(meta("name", "description"));
    expect(meta("name", "description")?.length).toBeGreaterThan(40);
    for (const file of ["index.html", "public/manifest.webmanifest"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/Амедро|Amedro/i);
    }
  });

  it("адреса й картинка абсолютні, на домені сайту, а картинка справді є", () => {
    expect(appUrl).toMatch(/^https:\/\//);
    expect(meta("property", "og:url")).toBe(`${appUrl}/`);
    const image = meta("property", "og:image") ?? "";
    expect(image.startsWith(`${appUrl}/`)).toBe(true);
    expect(existsSync(`public/${image.slice(appUrl!.length + 1)}`)).toBe(true);
  });
});
