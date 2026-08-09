import { describe, expect, it } from "vitest";
import { fetchSource, normalizeRecords, parseFallbackJson } from "../src/sync.js";

const record = {
  year: 2026,
  period: 1,
  drawDate: "2026-01-01",
  balls: ["01馬(红)", "02蛇(红)", "03龍(蓝)", "04兔(蓝)", "05虎(绿)", "06牛(绿)", "07鼠(红)"]
};

describe("开奖源解析", () => {
  it("解析历史源并保留七个号码", () => {
    const records = parseFallbackJson(JSON.stringify({ data: [{
      expect: "2026220",
      openTime: "2026-08-08 21:32:32",
      openCode: "27,39,04,12,38,25,48",
      zodiac: "龍,龍,兔,羊,蛇,馬,羊",
      wave: "green,green,blue,red,green,blue,blue"
    }] }));
    expect(records[0]).toMatchObject({ year: 2026, period: 220, drawDate: "2026-08-08" });
    expect(records[0].balls).toEqual([
      "27龍(绿)", "39龍(绿)", "04兔(蓝)", "12羊(红)", "38蛇(绿)", "25馬(蓝)", "48羊(蓝)"
    ]);
  });

  it("内容相同的重复期号合并", () => {
    expect(normalizeRecords([record, structuredClone(record)])).toEqual([record]);
  });

  it("同一期内容冲突时拒绝同步", () => {
    expect(() => normalizeRecords([record, { ...record, drawDate: "2026-01-02" }]))
      .toThrow("同一期存在冲突数据");
  });

  it("一期内号码重复时拒绝同步", () => {
    const invalid = { ...record, balls: [...record.balls.slice(0, 6), "01馬(红)"] };
    expect(() => normalizeRecords([invalid])).toThrow("号码重复");
  });

  it("主源失败后使用备用源", async () => {
    const calls = [];
    const fetchImpl = async url => {
      calls.push(url);
      if (calls.length === 1) return new Response("forbidden", { status: 403 });
      return new Response(JSON.stringify({ data: [{
        expect: "2026001",
        openTime: "2026-01-01 21:32:32",
        openCode: "01,02,03,04,05,06,07",
        zodiac: "馬,蛇,龍,兔,虎,牛,鼠",
        wave: "red,red,blue,blue,green,green,red"
      }] }), { status: 200 });
    };
    const result = await fetchSource(fetchImpl);
    expect(calls).toHaveLength(2);
    expect(result.records).toHaveLength(1);
    expect(result.sourceUrl).toContain("macaumarksix.com");
  });
});
