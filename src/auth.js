import { HttpError } from "./http-error.js";

export const SESSION_COOKIE = "tema_admin_session";
export const SESSION_TTL_SECONDS = 30 * 60;

const encoder = new TextEncoder();

function requireAdminPassword(password) {
  if (!/^\d{4}$/.test(String(password || ""))) {
    throw new HttpError(500, "管理员密码必须是四位数字");
  }
  return String(password);
}

function requireSessionSecret(secret) {
  if (String(secret || "").length < 32) {
    throw new HttpError(500, "会话签名密钥至少需要 32 个字符");
  }
  return String(secret);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(requireSessionSecret(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyAdminPassword(candidate, expected) {
  const configuredPassword = requireAdminPassword(expected);
  const [candidateDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(candidate || ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(configuredPassword))
  ]);
  return constantTimeEqual(new Uint8Array(candidateDigest), new Uint8Array(expectedDigest));
}

export async function createSessionCookie(secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const expiresAt = nowSeconds + SESSION_TTL_SECONDS;
  const payload = `admin.${expiresAt}`;
  const signature = base64Url(await hmac(payload, secret));
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

function readCookie(cookieHeader, name) {
  const match = String(cookieHeader || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : "";
}

export async function verifySessionCookie(cookieHeader, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) return false;
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  const match = token.match(/^admin\.(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt) || expiresAt < nowSeconds) return false;
  const payload = `admin.${expiresAt}`;
  const expected = base64Url(await hmac(payload, secret));
  return constantTimeEqual(encoder.encode(match[2]), encoder.encode(expected));
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new HttpError(403, "请求来源不允许");
  }
}

export async function createClientHash(ip, secret) {
  return base64Url(await hmac(`client:${String(ip || "unknown")}`, secret));
}

export async function assertLoginAllowed(db, clientHash) {
  await db.prepare("DELETE FROM admin_login_attempts WHERE expires_at <= CURRENT_TIMESTAMP").run();
  const row = await db.prepare("SELECT COUNT(*) count FROM admin_login_attempts WHERE client_hash = ? AND expires_at > CURRENT_TIMESTAMP")
    .bind(clientHash).first();
  if (Number(row?.count || 0) >= 5) throw new HttpError(429, "密码错误次数过多，请稍后再试");
}

export async function recordFailedLogin(db, clientHash) {
  await db.prepare("INSERT INTO admin_login_attempts (client_hash, expires_at) VALUES (?, datetime('now', '+10 minutes'))")
    .bind(clientHash).run();
}

export async function clearFailedLogins(db, clientHash) {
  await db.prepare("DELETE FROM admin_login_attempts WHERE client_hash = ?").bind(clientHash).run();
}
