# Tema 架构说明

## 文件职责

- `src/index.js`：Worker 入口，分发 API 路由、返回统一 JSON 错误并托管静态页面。
- `src/auth.js`：管理员密码校验、HMAC 会话 Cookie、同源检查和登录失败限制。
- `src/sync.js`：访问两个开奖源，解析、标准化、去重并严格校验 2026 年记录。
- `src/records.js`：查询 D1、人工新增、同步写入和记录同步日志。
- `src/http-error.js`：定义可以安全返回给前端的 HTTP 错误。
- `public/index.html`：分析看板，通过同源 API 加载共享数据并触发管理员操作。
- `migrations/0001_initial.sql`：D1 表和索引。
- `migrations/0002_seed_2026.sql`：220 条初始开奖记录。
- `scripts/extract-seed.mjs`：从旧页面的 `seedCsv` 生成确定性的 D1 初始化 SQL。
- `test/`：Cloudflare Worker 运行时测试。
- `test-node/`：Node 文件生成和页面约束测试。
- `wrangler.jsonc`：Worker、静态资源和 D1 绑定配置。

## 调用关系

```text
public/index.html
  → /api/records、/api/status
  → /api/admin/login、/api/admin/sync、/api/admin/records
      → src/index.js
          → src/auth.js
          → src/sync.js → 外部开奖源
          → src/records.js → Cloudflare D1
```

## 关键决定

1. 页面和 API 由同一个 Worker 提供，避免跨域、第三方 Cookie 和双平台配置。
2. D1 是正式数据源，浏览器 `localStorage` 和内置 CSV 不再参与线上数据读取。
3. 管理员密码只通过 Cloudflare Secret 注入，仓库只保存认证逻辑。
4. 抓取数据全部校验后再批量写入；历史同一期内容不一致时不覆盖。
5. GitHub 保存代码，D1 保存业务数据；手动同步不再修改或提交 HTML。
