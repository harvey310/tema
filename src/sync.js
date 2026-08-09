export const PRIMARY_URL = "https://2025kj.zkclhb.com:2025/am.html";
export const FALLBACK_URL = "https://history.macaumarksix.com/history/macaujc2/y/2026";

const COLOR_NAMES = { red: "红", blue: "蓝", green: "绿" };
const BALL_PATTERN = /^(\d{2})([^\d()])\((红|蓝|绿)\)$/;

function standardBall(number, zodiac, wave) {
  const numeric = Number(number);
  const color = COLOR_NAMES[wave] || wave;
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 49) {
    throw new Error(`号码超出 01-49：${number}`);
  }
  if (!zodiac || String(zodiac).length !== 1) throw new Error(`生肖格式错误：${zodiac}`);
  if (!COLOR_NAMES[wave] && !["红", "蓝", "绿"].includes(color)) {
    throw new Error(`波色格式错误：${wave}`);
  }
  return `${String(numeric).padStart(2, "0")}${zodiac}(${color})`;
}

function validateRecord(record) {
  if (record.year !== 2026) throw new Error(`只允许 2026 年数据：${record.year}`);
  if (!Number.isInteger(record.period) || record.period < 1) throw new Error("期号格式错误");
  if (!/^2026-\d{2}-\d{2}$/.test(record.drawDate)) throw new Error(`开奖日期格式错误：${record.drawDate}`);
  if (!Array.isArray(record.balls) || record.balls.length !== 7) throw new Error(`第 ${record.period} 期不是七个号码`);
  const numbers = record.balls.map(ball => {
    const match = String(ball).match(BALL_PATTERN);
    if (!match) throw new Error(`号码格式错误：${ball}`);
    const numeric = Number(match[1]);
    if (numeric < 1 || numeric > 49) throw new Error(`号码超出 01-49：${ball}`);
    return numeric;
  });
  if (new Set(numbers).size !== 7) throw new Error(`第 ${record.period} 期号码重复`);
  return record;
}

function recordContent(record) {
  return JSON.stringify([record.drawDate, ...record.balls]);
}

export function normalizeRecords(records) {
  const byPeriod = new Map();
  for (const raw of records) {
    const record = validateRecord(raw);
    const existing = byPeriod.get(record.period);
    if (existing && recordContent(existing) !== recordContent(record)) {
      throw new Error(`同一期存在冲突数据：${record.period}期`);
    }
    if (!existing) byPeriod.set(record.period, record);
  }
  const normalized = [...byPeriod.values()].sort((left, right) => left.period - right.period);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].period !== normalized[index - 1].period + 1) {
      throw new Error(`期号不连续：${normalized[index - 1].period} 后为 ${normalized[index].period}`);
    }
  }
  return normalized;
}

export function parseFallbackJson(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("历史源不是有效 JSON");
  }
  if (!Array.isArray(payload.data)) throw new Error("历史源缺少 data 数组");
  return payload.data.filter(item => String(item.expect || "").startsWith("2026")).map(item => {
    const period = Number(String(item.expect).slice(4));
    const drawDate = String(item.openTime || "").slice(0, 10);
    const numbers = String(item.openCode || "").split(",");
    const zodiacs = String(item.zodiac || "").split(",");
    const waves = String(item.wave || "").split(",");
    if (numbers.length !== 7 || zodiacs.length !== 7 || waves.length !== 7) {
      throw new Error(`历史源第 ${period || "未知"} 期字段不完整`);
    }
    return {
      year: 2026,
      period,
      drawDate,
      balls: numbers.map((number, index) => standardBall(number, zodiacs[index], waves[index]))
    };
  });
}

export function parsePrimaryHtml(html) {
  const records = [];
  const matches = String(html).matchAll(/<li>\s*<dt><b>(\d+)<\/b>期\(开奖时间:(\d{4}-\d{2}-\d{2})\)<\/dt>\s*<dl>([\s\S]*?)<\/dl>\s*<\/li>/g);
  for (const match of matches) {
    if (!match[2].startsWith("2026-")) continue;
    const balls = [...match[3].matchAll(/<span class=["'](red|blue|green)["']>(\d{1,2})<\/span><b>([^<]+)<\/b>/g)]
      .map(item => standardBall(item[2], item[3].trim(), item[1]));
    if (balls.length !== 7) throw new Error(`指定源第 ${match[1]} 期不是七个号码`);
    records.push({ year: 2026, period: Number(match[1]), drawDate: match[2], balls });
  }
  if (!records.length) throw new Error("指定源没有解析到 2026 年开奖记录");
  return records;
}

async function requestSource(fetchImpl, url, parser) {
  const response = await fetchImpl(url, { headers: { accept: "text/html,application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const records = normalizeRecords(parser(await response.text()));
  if (!records.length) throw new Error("没有有效开奖记录");
  return { sourceUrl: url, records };
}

export async function fetchSource(fetchImpl = fetch) {
  let primaryError;
  try {
    return await requestSource(fetchImpl, PRIMARY_URL, parsePrimaryHtml);
  } catch (error) {
    primaryError = error;
  }
  try {
    return await requestSource(fetchImpl, FALLBACK_URL, parseFallbackJson);
  } catch (fallbackError) {
    throw new Error(`指定源失败：${primaryError.message}；历史源失败：${fallbackError.message}`);
  }
}
