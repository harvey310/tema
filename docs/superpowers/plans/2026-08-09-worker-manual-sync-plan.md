# Tema Worker 手动同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有静态开奖看板升级为 Cloudflare Worker + D1 动态应用，管理员登录后可抓取、校验、同步和手工新增开奖记录。

**Architecture:** Worker 同域提供静态页面与 `/api` 接口；D1 保存开奖记录、同步日志和登录失败记录；管理员密码与会话签名密钥仅保存在 Cloudflare Secret。前端不再直接访问源站，也不再用 `localStorage` 保存正式数据。

**Tech Stack:** Cloudflare Workers、Workers Static Assets、D1、JavaScript ES Modules、Wrangler 4.120.0、Vitest 4.1.10、Cloudflare Vitest Pool 0.20.3。

---

## 文件结构

- `public/index.html`：由现有 `index.html` 迁移，改为 API 驱动的动态看板。
- `src/index.js`：Worker 路由与统一 JSON 错误处理。
- `src/http-error.js`：可安全返回给客户端的状态码和中文错误类型。
- `src/auth.js`：密码校验、签名 Cookie、Origin 检查和登录频率限制。
- `src/records.js`：开奖记录查询、校验、批量写入和人工新增。
- `src/sync.js`：双数据源抓取、解析、去重、冲突检测和同步编排。
- `migrations/0001_initial.sql`：三个 D1 表及索引。
- `migrations/0002_seed_2026.sql`：当前 220 条正式数据初始化。
- `scripts/extract-seed.mjs`：从已验证的现有 HTML 生成初始化 SQL。
- `test/*.test.js`：解析、认证、数据库和 HTTP 接口测试。
- `test/fixtures/`：脱敏且最小化的源站响应样例。
- `package.json`、`vitest.config.js`、`wrangler.jsonc`：运行、测试和部署配置。

## Task 1：搭建 Worker 项目骨架

**Files:**
- Create: `package.json`
- Create: `wrangler.jsonc`
- Create: `vitest.config.js`
- Create: `src/index.js`
- Create: `src/http-error.js`
- Move: `index.html` → `public/index.html`
- Test: `test/worker.test.js`

- [ ] **Step 1：写失败的健康检查测试**

```js
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("Worker", () => {
  it("返回健康状态", async () => {
    const response = await SELF.fetch("https://tema.test/api/status");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 2：创建依赖与测试配置**

```json
{
  "name": "tema",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate:local": "wrangler d1 migrations apply tema-db --local",
    "db:migrate:remote": "wrangler d1 migrations apply tema-db --remote",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "0.20.3",
    "vitest": "4.1.10",
    "wrangler": "4.120.0"
  }
}
```

```js
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: { wrangler: { configPath: "./wrangler.jsonc" } }
    }
  }
});
```

- [ ] **Step 3：创建 Worker 配置**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "tema",
  "main": "src/index.js",
  "compatibility_date": "2026-08-09",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "tema-db",
      "database_id": "local-tema-db",
      "migrations_dir": "migrations"
    }
  ]
}
```

- [ ] **Step 4：实现最小路由并迁移静态页面**

```js
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}
```

```js
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...headers }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/status" && request.method === "GET") {
      return json({ ok: true });
    }
    if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "接口不存在" }, 404);
    return env.ASSETS.fetch(request);
  }
};
```

Run: `npm install && npm test`

Expected: `1 passed, 0 failed`。

## Task 2：建立 D1 数据结构和初始化数据

**Files:**
- Create: `migrations/0001_initial.sql`
- Create: `scripts/extract-seed.mjs`
- Create: `migrations/0002_seed_2026.sql`
- Test: `test/seed.test.js`

- [ ] **Step 1：写初始化数据校验测试**

```js
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("D1 初始化数据", () => {
  it("包含 220 条且期号连续", () => {
    const sql = readFileSync("migrations/0002_seed_2026.sql", "utf8");
    const periods = [...sql.matchAll(/VALUES \(2026, (\d+),/g)].map(match => Number(match[1]));
    expect(periods).toEqual(Array.from({ length: 220 }, (_, index) => index + 1));
  });
});
```

- [ ] **Step 2：创建表结构**

```sql
CREATE TABLE draw_records (
  year INTEGER NOT NULL CHECK (year = 2026),
  period INTEGER NOT NULL CHECK (period > 0),
  draw_date TEXT NOT NULL CHECK (draw_date GLOB '2026-[0-1][0-9]-[0-3][0-9]'),
  normal_1 TEXT NOT NULL,
  normal_2 TEXT NOT NULL,
  normal_3 TEXT NOT NULL,
  normal_4 TEXT NOT NULL,
  normal_5 TEXT NOT NULL,
  normal_6 TEXT NOT NULL,
  special TEXT NOT NULL,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (year, period)
);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  source_url TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  latest_period INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  error_message TEXT
);

CREATE TABLE admin_login_attempts (
  client_hash TEXT NOT NULL,
  failed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_draw_records_date ON draw_records(draw_date);
CREATE INDEX idx_sync_runs_started ON sync_runs(started_at DESC);
CREATE INDEX idx_login_attempts_hash ON admin_login_attempts(client_hash, expires_at);
```

- [ ] **Step 3：实现确定性种子 SQL 生成脚本**

脚本读取迁移前保留的 `index.html`，提取 `seedCsv`，严格校验 220 行、9 列、连续期号和 2026 日期，再输出 `INSERT INTO draw_records (...) VALUES (...);`。SQL 字符串通过 `value.replaceAll("'", "''")` 转义；校验失败时进程以非零状态退出，不生成部分文件。

Run: `node scripts/extract-seed.mjs index.html migrations/0002_seed_2026.sql && npm test`

Expected: `seed.test.js` 通过，生成 220 条 INSERT。

## Task 3：实现源站解析与数据校验

**Files:**
- Create: `src/sync.js`
- Create: `test/fixtures/primary.html`
- Create: `test/fixtures/fallback.json`
- Test: `test/sync.test.js`

- [ ] **Step 1：写解析、去重和冲突测试**

```js
import { describe, expect, it } from "vitest";
import { normalizeRecords, parseFallbackJson } from "../src/sync.js";

describe("开奖源解析", () => {
  it("解析历史源并保留七个号码", () => {
    const records = parseFallbackJson(JSON.stringify({ data: [{
      expect: "2026220", openTime: "2026-08-08 21:32:32",
      openCode: "27,39,04,12,38,25,48",
      zodiac: "龍,龍,兔,羊,蛇,馬,羊",
      wave: "green,green,blue,red,green,blue,blue"
    }] }));
    expect(records[0]).toMatchObject({ year: 2026, period: 220, drawDate: "2026-08-08" });
    expect(records[0].balls).toHaveLength(7);
  });

  it("内容相同的重复期号合并", () => {
    const record = { year: 2026, period: 1, drawDate: "2026-01-01", balls: ["01馬(红)", "02蛇(红)", "03龍(蓝)", "04兔(蓝)", "05虎(绿)", "06牛(绿)", "07鼠(红)"] };
    expect(normalizeRecords([record, structuredClone(record)])).toHaveLength(1);
  });

  it("同一期内容冲突时拒绝同步", () => {
    const first = { year: 2026, period: 1, drawDate: "2026-01-01", balls: ["01馬(红)", "02蛇(红)", "03龍(蓝)", "04兔(蓝)", "05虎(绿)", "06牛(绿)", "07鼠(红)"] };
    const second = { ...first, drawDate: "2026-01-02" };
    expect(() => normalizeRecords([first, second])).toThrow("同一期存在冲突数据");
  });
});
```

- [ ] **Step 2：实现严格解析函数**

`src/sync.js` 固定导出 `PRIMARY_URL`、`FALLBACK_URL`、`parsePrimaryHtml`、`parseFallbackJson`、`normalizeRecords` 和 `fetchSource`。主源解析只接受 `<li><dt><b>期号</b>期(开奖时间:日期)</dt><dl>七个球</dl></li>`；备用源只接受 `expect/openTime/openCode/zodiac/wave` 五个字段。波色映射固定为 `{ red: "红", blue: "蓝", green: "绿" }`；每个标准球格式为两位号码加生肖和波色，例如 `27龍(绿)`。任何字段缺失、数组长度不等于 7、号码超界、一期内号码重复、期号冲突或期号不连续都抛出明确错误。`fetchSource` 只有在主源网络失败、非 2xx 或解析失败时才请求备用源，成功返回 `{ sourceUrl, records }`，两个来源都失败时合并两个明确错误原因后抛出。

Run: `npm test -- test/sync.test.js`

Expected: `3 passed, 0 failed`。

## Task 4：实现管理员认证

**Files:**
- Create: `src/auth.js`
- Test: `test/auth.test.js`

- [ ] **Step 1：写签名、过期和密码错误测试**

```js
import { describe, expect, it } from "vitest";
import { createSessionCookie, verifyAdminPassword, verifySessionCookie } from "../src/auth.js";

describe("管理员认证", () => {
  it("正确密码通过，错误密码失败", async () => {
    await expect(verifyAdminPassword("2468", "2468")).resolves.toBe(true);
    await expect(verifyAdminPassword("0000", "2468")).resolves.toBe(false);
  });

  it("签名会话可验证且过期后失效", async () => {
    const cookie = await createSessionCookie("secret-for-test", 1_000);
    await expect(verifySessionCookie(cookie, "secret-for-test", 1_001)).resolves.toBe(true);
    await expect(verifySessionCookie(cookie, "secret-for-test", 1_000 + 30 * 60 + 1)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2：实现 Web Crypto 会话**

`src/auth.js` 使用 `crypto.subtle.importKey` 和 HMAC-SHA256 对 `admin.<expiresAt>` 签名。Cookie 名称固定为 `tema_admin_session`，属性固定为 `Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800`。密码使用相同长度的 `Uint8Array` 和逐字节异或比较；未配置 Secret 时抛出“管理员安全配置缺失”。

- [ ] **Step 3：实现同源校验与失败限制**

```js
export function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) throw new HttpError(403, "请求来源不允许");
}

export async function assertLoginAllowed(db, clientHash) {
  await db.prepare("DELETE FROM admin_login_attempts WHERE expires_at <= CURRENT_TIMESTAMP").run();
  const row = await db.prepare("SELECT COUNT(*) count FROM admin_login_attempts WHERE client_hash = ? AND expires_at > CURRENT_TIMESTAMP").bind(clientHash).first();
  if (row.count >= 5) throw new HttpError(429, "密码错误次数过多，请稍后再试");
}
```

Run: `npm test -- test/auth.test.js`

Expected: `2 passed, 0 failed`。

## Task 5：实现 D1 记录服务与同步事务

**Files:**
- Create: `src/records.js`
- Modify: `src/sync.js`
- Test: `test/records.test.js`

- [ ] **Step 1：写新增、重复和历史冲突测试**

使用 Cloudflare Vitest 测试环境的 `env.DB`，每个测试前应用 migration。覆盖：空库批量插入成功、相同历史记录不重复插入、同一期内容不同整次失败、人工新增已有期号返回冲突。

- [ ] **Step 2：实现记录查询与校验**

`src/records.js` 导出 `listRecords(db)`、`getStatus(db)`、`insertManualRecord(db, record, sourceUrl)`、`syncRecords(db, records, sourceUrl)`。查询统一按 `period ASC`；写入使用参数绑定，不拼接 SQL。

- [ ] **Step 3：实现原子批量写入**

同步前一次查询现有期号和完整内容；发现冲突立即抛错。需要新增的记录使用 `db.batch()` 批量执行，并在同一批次更新 `sync_runs` 成功状态。执行失败时更新该同步日志为 `failed`，不得修改已有 `draw_records`。

Run: `npm test -- test/records.test.js`

Expected: `4 passed, 0 failed`。

## Task 6：完成 Worker API 路由

**Files:**
- Modify: `src/index.js`
- Test: `test/api.test.js`

- [ ] **Step 1：写公共与管理员接口测试**

测试 `GET /api/records`、`GET /api/status`、密码错误、未登录同步返回 401、登录后同步成功、同源校验失败返回 403、重复同步返回 409、人工新增成功和已有期号返回 409。

- [ ] **Step 2：实现路由表**

```js
const routes = new Map([
  ["GET /api/records", getRecords],
  ["GET /api/status", getStatus],
  ["POST /api/admin/login", login],
  ["GET /api/admin/session", getSession],
  ["POST /api/admin/logout", logout],
  ["POST /api/admin/sync", sync],
  ["POST /api/admin/records", createRecord]
]);
```

所有响应格式固定为 `{ ok: boolean, data?: unknown, error?: string }`。只在服务器日志记录异常堆栈，客户端返回明确但不泄露 Secret 的中文信息。

Run: `npm test -- test/api.test.js`

Expected: `9 passed, 0 failed`。

## Task 7：把页面切换到共享 API

**Files:**
- Modify: `public/index.html`
- Test: `test/frontend.test.js`

- [ ] **Step 1：写静态结构与禁用本地正式数据测试**

```js
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("动态页面", () => {
  const html = readFileSync("public/index.html", "utf8");
  it("包含管理员更新入口", () => expect(html).toContain('id="updateDataBtn"'));
  it("包含管理员登录弹窗", () => expect(html).toContain('id="adminLoginModal"'));
  it("不再持久化正式开奖记录", () => expect(html).not.toContain("localStorage.setItem"));
  it("不再提供恢复初始数据", () => expect(html).not.toContain('id="resetBtn"'));
});
```

- [ ] **Step 2：修改页头和登录弹窗**

页头保留版本信息，删除“恢复”，增加 `<button id="updateDataBtn">更新数据</button>`。新增只包含四位密码输入框、取消和确认按钮的 `adminLoginModal`，输入框使用 `type="password" inputmode="numeric" minlength="4" maxlength="4" pattern="[0-9]{4}" autocomplete="current-password"`。

- [ ] **Step 3：改为 API 加载**

```js
let records = [];
let adminAuthenticated = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || "服务请求失败");
  return body.data;
}

async function loadSharedRecords() {
  const data = await api("/api/records?year=2026");
  records = data.records.map(toDashboardRecord);
  render();
}
```

页面启动时并行读取 `/api/records` 与 `/api/admin/session`。加载失败显示红色错误，不回退到 `seedCsv` 或旧缓存。

- [ ] **Step 4：接入登录、同步和人工新增**

更新按钮在未登录时打开密码弹窗；登录成功后调用 `/api/admin/sync`；成功后重新调用 `loadSharedRecords()`。现有新增表单改为提交七个号码到 `/api/admin/records`，管理员未登录时不显示入口。删除浏览器直接抓取、`parseRemoteHtml`、`loadRecords`、`saveRecords`、`appendNewRecords` 和恢复事件。

Run: `npm test -- test/frontend.test.js`

Expected: `4 passed, 0 failed`。

## Task 8：本地全链路验证和文档

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-09-worker-manual-sync-design.md` only if implementation exposes a confirmed discrepancy

- [ ] **Step 1：安装并运行全量测试**

Run: `npm install && npm test`

Expected: 所有测试通过，0 个失败。

- [ ] **Step 2：应用本地迁移并启动 Worker**

Run: `npm run db:migrate:local && npm run dev`

Expected: D1 两个 migration 成功，首页、`/api/status` 和 `/api/records` 可访问。

- [ ] **Step 3：执行浏览器验收**

使用本地 Secret 验证：未登录不能同步、错误密码失败、正确密码登录、同步无新增时返回最新、人工新增重复期号被拒绝。测试 Secret 只通过本地 `.dev.vars` 注入，`.dev.vars` 必须在 `.gitignore` 中，禁止提交。

- [ ] **Step 4：更新 README**

README 写明项目已升级为动态 Worker 应用、本地运行、测试、创建 D1、替换 `database_id`、应用远端迁移、设置两个 Secret 和 Git 构建页填写方式。不得记录管理员密码实际值。

- [ ] **Step 5：最终检查**

Run: `git diff --check && git status -sb && rg -n "ADMIN_PASSWORD=|SESSION_SECRET=" . -g '!node_modules' -g '!.git'`

Expected: diff 无格式错误；密钥扫描无匹配；改动只包含本计划文件。

## Task 9：Cloudflare 资源创建与部署（需要用户已登录账户）

**Files:**
- Modify: `wrangler.jsonc`（只替换 D1 `database_id`）

- [ ] **Step 1：确认 Cloudflare 登录**

Run: `npx wrangler whoami`

Expected: 显示用户当前 Cloudflare 账户。

- [ ] **Step 2：创建 D1 并回填 ID**

Run: `npx wrangler d1 create tema-db`

Expected: 返回数据库 ID；把该 ID 写入 `wrangler.jsonc` 的 `database_id`。

- [ ] **Step 3：应用远端迁移**

Run: `npm run db:migrate:remote`

Expected: `0001_initial.sql` 和 `0002_seed_2026.sql` 均成功。

- [ ] **Step 4：设置 Secret**

Run: `npx wrangler secret put ADMIN_PASSWORD`，在交互提示中输入用户确认的四位密码；随后运行 `npx wrangler secret put SESSION_SECRET`，输入本机安全随机生成的至少 32 字节值。两个值不得出现在命令参数、终端历史、文件或 Git diff 中。

- [ ] **Step 5：部署与线上验收**

Run: `npm run deploy`

Expected: 获得 `tema.<account>.workers.dev` 地址。线上验证公共读取、管理员登录、手动同步、不同浏览器共享最新记录及 Cloudflare 日志无未处理异常。

> Git 提交和推送必须等用户明确授权后执行；本实施计划不自动创建分支、提交或推送。
