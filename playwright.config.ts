import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: true,
  workers: 4,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5199", trace: "retain-on-failure", locale: "ru-RU", timezoneId: "Europe/Kyiv" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npx wrangler d1 migrations apply garage-e2e --local -c wrangler.e2e.jsonc && npx vite --port 5199 --strictPort",
    url: "http://localhost:5199/api/config",
    reuseExistingServer: true,
    timeout: 120_000,
    env: { WRANGLER_CONFIG: "wrangler.e2e.jsonc", CI: "1" },
  },
});
