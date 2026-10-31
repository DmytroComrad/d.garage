import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.test.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
                PASSWORD_PEPPER: "test-pepper-not-a-secret",
                TOKEN_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
          setupFiles: ["./tests/worker/setup.ts"],
        },
      },
    ],
  },
});
