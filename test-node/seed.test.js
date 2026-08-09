import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("D1 初始化数据包含 220 条且期号连续", () => {
  assert.equal(existsSync("migrations/0002_seed_2026.sql"), true);
  const sql = readFileSync("migrations/0002_seed_2026.sql", "utf8");
  const periods = [...sql.matchAll(/VALUES \(2026, (\d+),/g)].map(match => Number(match[1]));
  assert.deepEqual(periods, Array.from({ length: 220 }, (_, index) => index + 1));
});
