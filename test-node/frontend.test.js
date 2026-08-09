import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync("public/index.html", "utf8");

test("页面包含管理员更新入口", () => {
  assert.match(html, /id="updateDataBtn"/);
});

test("页面包含四位密码登录弹窗", () => {
  assert.match(html, /id="adminLoginModal"/);
  assert.match(html, /pattern="\[0-9\]\{4\}"/);
});

test("页面不再把正式数据写入 localStorage", () => {
  assert.doesNotMatch(html, /localStorage\.setItem/);
  assert.doesNotMatch(html, /const seedCsv/);
});

test("页面不再提供恢复初始数据", () => {
  assert.doesNotMatch(html, /id="resetBtn"/);
});

test("页面通过同源 API 更新而不是直接访问源站", () => {
  assert.match(html, /\/api\/admin\/sync/);
  assert.doesNotMatch(html, /fetch\(dataSourceUrl/);
});

test("页面合并组合聚合入口并读取已部署采集接口", () => {
  assert.match(html, /data-tab="combinations"/);
  assert.match(html, /id="combinationsPanel"/);
  assert.match(html, /tema-combination-collector\.whuxwy\.workers\.dev/);
  assert.match(html, /const combinationApi = `\$\{combinationApiBase\}\/api\/combinations`/);
  assert.match(html, /id="combinationPasswordModal"/);
  assert.match(html, /id="manualCombinationCrawl"/);
  assert.match(html, /\/api\/combinations\/crawl/);
});

test("组合聚合统计周期使用远端汇总接口", () => {
  assert.match(html, /combinationApi\}\/summary\?days=/);
});
