import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const origin = "https://tema.test";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

async function login(password = "2468") {
  return SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
    body: JSON.stringify({ password })
  });
}

describe("Worker API", () => {
  it("公共接口读取共享记录", async () => {
    const response = await SELF.fetch(`${origin}/api/records?year=2026`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { count: 0, records: [] } });
  });

  it("错误密码不能登录", async () => {
    const response = await login("0000");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "密码错误" });
  });

  it("拒绝跨来源登录", async () => {
    const response = await SELF.fetch(`${origin}/api/admin/login`, {
      method: "POST",
      headers: { origin: "https://attacker.test", "content-type": "application/json" },
      body: JSON.stringify({ password: "2468" })
    });
    expect(response.status).toBe(403);
  });

  it("登录后可以检查会话", async () => {
    const loginResponse = await login();
    const cookie = loginResponse.headers.get("set-cookie");
    expect(loginResponse.status).toBe(200);
    const response = await SELF.fetch(`${origin}/api/admin/session`, { headers: { cookie } });
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { authenticated: true } });
  });

  it("未登录不能同步", async () => {
    const response = await SELF.fetch(`${origin}/api/admin/sync`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}"
    });
    expect(response.status).toBe(401);
  });

  it("登录后可以抓取并同步", async () => {
    const cookie = (await login()).headers.get("set-cookie");
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => new Response("forbidden", { status: 403 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ data: [{
          expect: "2026001",
          openTime: "2026-01-01 21:32:32",
          openCode: "01,02,03,04,05,06,07",
          zodiac: "馬,蛇,龍,兔,虎,牛,鼠",
          wave: "red,red,blue,blue,green,green,red"
        }] }), { status: 200 }));
    const response = await SELF.fetch(`${origin}/api/admin/sync`, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: "{}"
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ ok: true, data: { insertedCount: 1, latestPeriod: 1 } });
  });

  it("管理员可以人工新增一期", async () => {
    const cookie = (await login()).headers.get("set-cookie");
    const response = await SELF.fetch(`${origin}/api/admin/records`, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({
        year: 2026,
        period: 1,
        drawDate: "2026-01-01",
        balls: ["01馬(红)", "02蛇(红)", "03龍(蓝)", "04兔(蓝)", "05虎(绿)", "06牛(绿)", "07鼠(红)"]
      })
    });
    expect(response.status).toBe(201);
    const records = await (await SELF.fetch(`${origin}/api/records?year=2026`)).json();
    expect(records.data.count).toBe(1);
  });
});
