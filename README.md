# Tema 分析看板

Tema 是一个部署在 Cloudflare Workers 上的澳门开奖记录分析看板。页面和 API 同域运行，2026 年开奖记录保存在 Cloudflare D1，所有设备读取同一份数据。

管理员输入四位密码后，可以在页面点击“更新数据”。服务端会抓取、校验并同步最新开奖记录；浏览器不直接访问源站，也不保存正式开奖记录。

## 技术结构

- Cloudflare Worker：页面托管、API、管理员认证和抓取同步。
- Workers Static Assets：托管 `public/index.html`。
- Cloudflare D1：保存开奖记录、同步日志和登录失败记录。
- Cloudflare Secrets：保存管理员密码和会话签名密钥。
- Vitest + Cloudflare Workers 测试池：验证 Worker 运行时、D1 和接口。

详细职责见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 本地运行

```bash
npm install
npm run db:migrate:local
npm run dev
```

本地管理员测试需要创建不会提交的 `.dev.vars`：

```text
ADMIN_PASSWORD=四位测试密码
SESSION_SECRET=至少32字节的本地随机值
```

访问 `http://127.0.0.1:8787`。

## 测试

```bash
npm test
```

- `npm run test:worker`：Worker、D1、认证、抓取与 API 测试。
- `npm run test:node`：初始化 SQL 和页面静态约束测试。

## 首次部署到 Cloudflare

### 1. 创建 D1 数据库

登录 Cloudflare CLI 后执行：

```bash
npx wrangler whoami
npx wrangler d1 create tema-db
```

把返回的真实 `database_id` 写入 `wrangler.jsonc`，替换本地值 `local-tema-db`。

### 2. 初始化远端数据库

```bash
npm run db:migrate:remote
```

此操作创建数据库表并导入当前已确认的 220 条 2026 年开奖记录。

### 3. 设置管理员密钥

以下命令会交互式读取值，不要把值写在命令参数、仓库或截图中：

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

- `ADMIN_PASSWORD`：输入已确认的四位管理员密码。
- `SESSION_SECRET`：输入至少 32 字节的随机值，可先在本机使用 `openssl rand -base64 32` 生成。

### 4. 部署

```bash
npm run deploy
```

## Cloudflare Git 创建页填写

- Project name：`tema`
- Build command：留空
- Deploy command：`npx wrangler deploy`
- Production branch：`main`

仓库推送后，Cloudflare 会自动构建和部署。

## 管理员操作规则

- 未登录用户只能读取共享开奖记录。
- 更新和人工新增需要管理员会话。
- 同一期数据不允许覆盖；抓取源与已有历史内容冲突时整次同步失败。
- 指定源不可用时才使用已验证历史源。
- 页面不提供“恢复初始数据”和删除共享记录，避免误操作。

## 数据来源

- 指定源：`https://2025kj.zkclhb.com:2025/am.html`
- 已验证备用源：`https://history.macaumarksix.com/history/macaujc2/y/2026`

只保存并公开 2026 年开奖记录。
