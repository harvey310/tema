import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations, reset, SELF } from "cloudflare:test";
import { afterEach, beforeEach } from "vitest";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

afterEach(async () => {
  await reset();
});

describe("Worker", () => {
  it("返回健康状态", async () => {
    const response = await SELF.fetch("https://tema.test/api/status");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });
});
