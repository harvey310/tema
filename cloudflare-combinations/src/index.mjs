import { buildSummary } from './aggregate.mjs';
import { parseNumbers, parseOddEven, parsePeriodRange, parseZodiacs, sliceModule, validateItems } from './parser.mjs';
import { SOURCES } from './sources.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' } });

function parseSource(source, html) {
  const titles = source.titles || [source.title];
  let section;
  let lastError;
  for (const title of titles) {
    try {
      section = sliceModule(html, title).slice(0, source.sectionLength || 1800);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!section) throw lastError;
  let periodRange = parsePeriodRange(section);
  let zodiacs = [];
  let numbers = [];
  if (source.kind === 'zodiacs') {
    const group = latestZodiacGroup(section, source.count);
    periodRange = group.periodRange || periodRange;
    zodiacs = group.items;
  }
  if (source.kind === 'wuxiao') zodiacs = validateItems(parseZodiacs(section), { label: source.label, kind: 'zodiacs', count: source.count });
  if (source.kind === 'numbers') {
    const group = latestNumberGroup(section, source.count);
    periodRange = group.periodRange || periodRange;
    numbers = group.items;
  }
  if (source.kind === 'wuxiao') numbers = parseNumbers(section).slice(-2);
  if (source.kind === 'odd_even') {
    const pairs = parseOddEven(section);
    validateItems(pairs.odd, { label: `${source.label}单号`, kind: 'numbers', count: source.count });
    validateItems(pairs.even, { label: `${source.label}双号`, kind: 'numbers', count: source.count });
    numbers = [...pairs.odd, ...pairs.even];
  }
  return { periodRange, zodiacs, numbers, evidence: section.slice(0, 1200) };
}

function latestZodiacGroup(section, count) {
  const candidates = [...section.matchAll(new RegExp(`[鼠牛虎兔龙蛇马羊猴鸡狗猪]{${count}}`, 'g'))];
  if (!candidates.length) throw new Error(`未识别到${count}个连续生肖`);
  const candidate = candidates.at(-1);
  return {
    items: validateItems([...candidate[0]], { label: '生肖组合', kind: 'zodiacs', count }),
    periodRange: latestPeriodRangeBefore(section, candidate.index)
  };
}

function latestNumberGroup(section, count) {
  const candidatePattern = new RegExp(`(?<!\\d)((?:\\d{1,2}(?:\\s+|[,，.。])*){${count}})(?!\\d)`, 'g');
  const candidates = [...section.matchAll(candidatePattern)].flatMap(candidate => {
    try {
      return [{ index: candidate.index, items: parseNumbers(candidate[1]) }];
    } catch {
      return [];
    }
  }).filter(candidate => candidate.items.length === count);
  if (!candidates.length) throw new Error(`未识别到${count}个连续号码`);
  const candidate = candidates.at(-1);
  return {
    items: validateItems(candidate.items, { label: '号码组合', kind: 'numbers', count }),
    periodRange: latestPeriodRangeBefore(section, candidate.index)
  };
}

function latestPeriodRangeBefore(section, index) {
  const nearby = section.slice(Math.max(0, index - 120), index);
  const periodMatches = [...nearby.matchAll(/(?:第\s*)?(\d{1,3})\s*期/g)];
  const ranges = [...nearby.matchAll(/(\d{1,3})\s*-\s*(\d{1,3})\s*期/g)];
  const lastRange = ranges.at(-1);
  const lastPeriod = periodMatches.at(-1);
  if (lastRange && (!lastPeriod || lastPeriod.index <= lastRange.index + lastRange[0].length)) return `${Number(lastRange[1])}-${Number(lastRange[2])}期`;
  if (periodMatches.length >= 2) {
    const current = periodMatches.slice(-3).map(match => Number(match[1]));
    return `${Math.min(...current)}-${Math.max(...current)}期`;
  }
  const allRanges = [...section.slice(0, index).matchAll(/(\d{1,3})\s*-\s*(\d{1,3})\s*期/g)];
  if (!allRanges.length) return '';
  const [, start, end] = allRanges.at(-1);
  return `${Number(start)}-${Number(end)}期`;
}

export async function crawlSource(source, { fetchHtml, renderHtml, capturedAt = new Date().toISOString() }) {
  const errors = [];
  for (const [status, loader] of [['success_http', fetchHtml], ['success_browser', renderHtml]]) {
    try {
      const html = await loader(source.url);
      const parsed = parseSource(source, html);
      const contentHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parsed)));
      const hash = [...new Uint8Array(contentHash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      return { ...parsed, sourceKey: source.key, sourceLabel: source.label, sourceUrl: source.url, status, capturedAt, contentHash: hash, error: '' };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { sourceKey: source.key, sourceLabel: source.label, sourceUrl: source.url, status: 'failed', capturedAt, periodRange: '', zodiacs: [], numbers: [], evidence: '', contentHash: '', error: errors.join('；') };
}

export async function fetchHtmlWithFrames(url, fetchImpl = fetch, depth = 0, seen = new Set()) {
  if (seen.has(url)) return '';
  seen.add(url);
  const response = await fetchImpl(url, { headers: { 'user-agent': 'tema-combination-collector/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (depth >= 1) return html;
  const base = new URL(url);
  const frames = [...html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map(match => new URL(match[1], base).href)
    .filter(frameUrl => new URL(frameUrl).origin === base.origin);
  if (!frames.length) return html;
  const frameHtml = await Promise.all(frames.map(frameUrl => fetchHtmlWithFrames(frameUrl, fetchImpl, depth + 1, seen)));
  return [html, ...frameHtml].join('\n');
}

async function defaultFetchHtml(url) {
  return fetchHtmlWithFrames(url);
}

async function defaultRenderHtml(browser, url) {
  const response = await browser.quickAction('content', { url, gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 }, actionTimeout: 30000 });
  if (!response.ok) throw new Error(`Browser Run HTTP ${response.status}`);
  const payload = await response.json();
  return typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result ?? payload);
}

async function saveRecord(db, record) {
  await db.prepare(`INSERT OR IGNORE INTO combination_records (source_key, source_label, source_url, period_range, status, captured_at, content_hash, evidence, error_message, zodiacs_json, numbers_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(record.sourceKey, record.sourceLabel, record.sourceUrl, record.periodRange, record.status, record.capturedAt, record.contentHash, record.evidence, record.error, JSON.stringify(record.zodiacs), JSON.stringify(record.numbers)).run();
}

async function crawlAll(env) {
  const results = [];
  for (const source of SOURCES) {
    const record = await crawlSource(source, { fetchHtml: defaultFetchHtml, renderHtml: url => defaultRenderHtml(env.BROWSER, url) });
    await saveRecord(env.DB, record);
    results.push(record);
  }
  return results;
}

async function getRecords(db, date) {
  const { results } = await db.prepare(`SELECT * FROM combination_records WHERE id IN (SELECT MAX(id) FROM combination_records WHERE substr(captured_at, 1, 10) = ? GROUP BY source_key) ORDER BY captured_at DESC`).bind(date).all();
  return results.map(row => ({ ...row, sourceKey: row.source_key, sourceLabel: row.source_label, sourceUrl: row.source_url, periodRange: row.period_range, capturedAt: row.captured_at, contentHash: row.content_hash, evidence: row.evidence, error: row.error_message, zodiacs: JSON.parse(row.zodiacs_json), numbers: JSON.parse(row.numbers_json) }));
}

export function createWorker({ crawl = crawlAll } = {}) {
  return {
  async scheduled(_event, env, ctx) { ctx.waitUntil(crawl(env)); },
  async fetch(request, env, ctx = { waitUntil() {} }) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST' } });
    if (url.pathname === '/api/combinations/crawl' && request.method === 'POST') {
      ctx.waitUntil(crawl(env));
      return json({ status: 'started', sourceCount: SOURCES.length }, 202);
    }
    if (url.pathname === '/api/combinations') return json({ date: url.searchParams.get('date') || new Date().toISOString().slice(0, 10), records: await getRecords(env.DB, url.searchParams.get('date') || new Date().toISOString().slice(0, 10)) });
    if (url.pathname === '/api/combinations/summary') {
      const days = Number(url.searchParams.get('days') || 7);
      if (![7, 30].includes(days)) return json({ error: 'days 仅支持 7 或 30' }, 400);
      const { results } = await env.DB.prepare('SELECT * FROM combination_records').all();
      const records = results.map(row => ({ capturedAt: row.captured_at, sourceKey: row.source_key, status: row.status, zodiacs: JSON.parse(row.zodiacs_json), numbers: JSON.parse(row.numbers_json) }));
      return json(buildSummary(records, days));
    }
    return json({ error: 'not found' }, 404);
  }
  };
}

export default createWorker();
