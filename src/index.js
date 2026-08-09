import {
  assertLoginAllowed,
  assertSameOrigin,
  clearFailedLogins,
  clearSessionCookie,
  createClientHash,
  createSessionCookie,
  recordFailedLogin,
  verifyAdminPassword,
  verifySessionCookie
} from "./auth.js";
import { HttpError } from "./http-error.js";
import { getStatus as readStatus, insertManualRecord, listRecords, recordSyncFailure, syncRecords } from "./records.js";
import { fetchSource } from "./sync.js";

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

async function readJson(request) {
  if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "请求必须使用 JSON 格式");
  }
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "JSON 内容格式错误");
  }
}

async function isAdmin(request, env) {
  return verifySessionCookie(request.headers.get("cookie"), env.SESSION_SECRET);
}

async function requireAdmin(request, env) {
  if (!(await isAdmin(request, env))) throw new HttpError(401, "请先输入管理员密码");
}

async function getRecords(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get("year") && url.searchParams.get("year") !== "2026") {
    throw new HttpError(400, "目前只支持 2026 年数据");
  }
  const records = await listRecords(env.DB);
  return json({ ok: true, data: { count: records.length, records } });
}

async function getStatus(_request, env) {
  return json({ ok: true, data: await readStatus(env.DB) });
}

async function login(request, env) {
  assertSameOrigin(request);
  const { password } = await readJson(request);
  const clientHash = await createClientHash(request.headers.get("CF-Connecting-IP"), env.SESSION_SECRET);
  await assertLoginAllowed(env.DB, clientHash);
  if (!/^\d{4}$/.test(String(password || "")) || !(await verifyAdminPassword(password, env.ADMIN_PASSWORD))) {
    await recordFailedLogin(env.DB, clientHash);
    throw new HttpError(401, "密码错误");
  }
  await clearFailedLogins(env.DB, clientHash);
  return json(
    { ok: true, data: { authenticated: true } },
    200,
    { "set-cookie": await createSessionCookie(env.SESSION_SECRET) }
  );
}

async function getSession(request, env) {
  return json({ ok: true, data: { authenticated: await isAdmin(request, env) } });
}

async function logout(request) {
  assertSameOrigin(request);
  return json({ ok: true, data: { authenticated: false } }, 200, { "set-cookie": clearSessionCookie() });
}

async function sync(request, env) {
  assertSameOrigin(request);
  await requireAdmin(request, env);
  await readJson(request);
  let source;
  try {
    source = await fetchSource();
  } catch (error) {
    await recordSyncFailure(env.DB, error);
    throw new HttpError(502, error.message);
  }
  return json({ ok: true, data: await syncRecords(env.DB, source.records, source.sourceUrl) });
}

async function createRecord(request, env) {
  assertSameOrigin(request);
  await requireAdmin(request, env);
  const record = await insertManualRecord(env.DB, await readJson(request));
  return json({ ok: true, data: record }, 201);
}

const routes = new Map([
  ["GET /api/records", getRecords],
  ["GET /api/status", getStatus],
  ["POST /api/admin/login", login],
  ["GET /api/admin/session", getSession],
  ["POST /api/admin/logout", logout],
  ["POST /api/admin/sync", sync],
  ["POST /api/admin/records", createRecord]
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const handler = routes.get(`${request.method} ${url.pathname}`);
    if (handler) {
      try {
        return await handler(request, env);
      } catch (error) {
        if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status);
        console.error("Unhandled API error", error);
        return json({ ok: false, error: "服务暂时不可用" }, 500);
      }
    }
    if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "接口不存在" }, 404);
    return env.ASSETS.fetch(request);
  }
};
