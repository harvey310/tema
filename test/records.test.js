import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertManualRecord, listRecords, syncRecords } from "../src/records.js";

const first = {
  year: 2026,
  period: 1,
  drawDate: "2026-01-01",
  balls: ["01馬(红)", "02蛇(红)", "03龍(蓝)", "04兔(蓝)", "05虎(绿)", "06牛(绿)", "07鼠(红)"]
};

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

afterEach(async () => {
  await reset();
});

describe("开奖记录服务", () => {
  it("向空库批量写入记录", async () => {
    const result = await syncRecords(env.DB, [first], "https://source.test");
    expect(result.insertedCount).toBe(1);
    expect(await listRecords(env.DB)).toHaveLength(1);
  });

  it("相同历史记录不会重复写入", async () => {
    await syncRecords(env.DB, [first], "https://source.test");
    const result = await syncRecords(env.DB, [structuredClone(first)], "https://source.test");
    expect(result.insertedCount).toBe(0);
    expect(await listRecords(env.DB)).toHaveLength(1);
  });

  it("同一期历史内容变化时整次拒绝", async () => {
    await syncRecords(env.DB, [first], "https://source.test");
    await expect(syncRecords(env.DB, [{ ...first, drawDate: "2026-01-02" }], "https://source.test"))
      .rejects.toThrow("历史数据冲突");
    expect((await listRecords(env.DB))[0].drawDate).toBe("2026-01-01");
  });

  it("人工新增不能覆盖已有期号", async () => {
    await insertManualRecord(env.DB, first);
    await expect(insertManualRecord(env.DB, first)).rejects.toMatchObject({ status: 409 });
  });
});
