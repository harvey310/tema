import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: (await readD1Migrations("migrations")).slice(0, 1),
          ADMIN_PASSWORD: "2468",
          SESSION_SECRET: "test-session-secret-that-is-long-enough"
        }
      }
    }))
  ],
  test: {
    exclude: ["test-node/**", "cloudflare-combinations/**", "node_modules/**"]
  }
});
