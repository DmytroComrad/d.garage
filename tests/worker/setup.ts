import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_MIGRATIONS: D1Migration[];
    DB: D1Database;
  }
}

beforeAll(async () => {
  const testEnv = env as unknown as { DB: D1Database; TEST_MIGRATIONS: D1Migration[] };
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});
