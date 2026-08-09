import { describe, expect, it } from "vitest";
import {
  assertSameOrigin,
  createClientHash,
  createSessionCookie,
  verifyAdminPassword,
  verifySessionCookie
} from "../src/auth.js";

describe("管理员认证", () => {
  const sessionSecret = "test-session-secret-at-least-32-characters";

  it("正确密码通过，错误密码失败", async () => {
    await expect(verifyAdminPassword("2468", "2468")).resolves.toBe(true);
    await expect(verifyAdminPassword("0000", "2468")).resolves.toBe(false);
  });

  it("管理员密码配置必须是四位数字", async () => {
    await expect(verifyAdminPassword("password", "password")).rejects.toThrow("管理员密码必须是四位数字");
  });

  it("签名会话可验证且过期后失效", async () => {
    const cookie = await createSessionCookie(sessionSecret, 1_000);
    await expect(verifySessionCookie(cookie, sessionSecret, 1_001)).resolves.toBe(true);
    await expect(verifySessionCookie(cookie, sessionSecret, 1_000 + 30 * 60 + 1)).resolves.toBe(false);
  });

  it("篡改会话后失效", async () => {
    const cookie = await createSessionCookie(sessionSecret, 1_000);
    await expect(verifySessionCookie(cookie.replace("admin.", "guest."), sessionSecret, 1_001)).resolves.toBe(false);
  });

  it("拒绝过短的会话签名密钥", async () => {
    await expect(createSessionCookie("short-secret", 1_000)).rejects.toThrow("会话签名密钥至少需要 32 个字符");
  });

  it("拒绝不同来源的写请求", () => {
    const request = new Request("https://tema.test/api/admin/sync", {
      method: "POST",
      headers: { origin: "https://attacker.test" }
    });
    expect(() => assertSameOrigin(request)).toThrow("请求来源不允许");
  });

  it("客户端标识不保存明文 IP", async () => {
    const hash = await createClientHash("203.0.113.10", sessionSecret);
    expect(hash).not.toContain("203.0.113.10");
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
