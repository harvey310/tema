import assert from 'node:assert/strict';
import test from 'node:test';
import { crawlSource, createWorker, fetchHtmlWithFrames } from '../src/index.mjs';

const source = { key: 'demo', label: '演示六肖', url: 'https://example.test', title: '演示六肖', kind: 'zodiacs', count: 6 };

test('crawl uses HTTP result without starting browser fallback', async () => {
  let browserCalls = 0;
  const result = await crawlSource(source, {
    fetchHtml: async () => '<div>演示六肖 201期 必出 牛虎兔龙蛇马</div>',
    renderHtml: async () => { browserCalls += 1; return ''; },
    capturedAt: '2026-08-09T11:00:00Z'
  });
  assert.equal(result.status, 'success_http');
  assert.equal(browserCalls, 0);
});

test('crawl falls back to browser when HTTP lacks target block', async () => {
  let browserCalls = 0;
  const result = await crawlSource(source, {
    fetchHtml: async () => '<div>missing</div>',
    renderHtml: async () => { browserCalls += 1; return '<div>演示六肖 202期 必出 鼠牛虎兔龙蛇</div>'; },
    capturedAt: '2026-08-09T11:00:00Z'
  });
  assert.equal(result.status, 'success_browser');
  assert.equal(browserCalls, 1);
});

test('crawl preserves error message after both methods fail', async () => {
  const result = await crawlSource(source, {
    fetchHtml: async () => '<div>missing</div>',
    renderHtml: async () => { throw new Error('browser quota exceeded'); },
    capturedAt: '2026-08-09T11:00:00Z'
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /未找到目标模块/);
  assert.match(result.error, /browser quota exceeded/);
});

test('HTTP loader includes first-party iframe content before browser fallback', async () => {
  const pages = new Map([
    ['https://example.test/', '<iframe src="/content.html"></iframe>'],
    ['https://example.test/content.html', '<div>演示六肖 221期 必出 牛虎兔龙蛇马</div>']
  ]);
  const html = await fetchHtmlWithFrames('https://example.test/', async url => new Response(pages.get(url), { status: 200 }));
  const result = await crawlSource(source, {
    fetchHtml: async () => html,
    renderHtml: async () => { throw new Error('browser should not run'); },
    capturedAt: '2026-08-09T11:00:00Z'
  });

  assert.equal(result.status, 'success_http');
  assert.match(result.evidence, /演示六肖/);
});

test('zodiac source selects the latest valid group inside a module', async () => {
  const result = await crawlSource(source, {
    fetchHtml: async () => '<div>演示六肖 219-221期 必出【虎牛狗龙猪猴】 222-224期 必出【猪虎牛龙鼠蛇】</div>',
    renderHtml: async () => { throw new Error('browser should not run'); },
    capturedAt: '2026-08-09T11:00:00Z'
  });

  assert.equal(result.status, 'success_http');
  assert.equal(result.periodRange, '222-224期');
  assert.deepEqual(result.zodiacs, ['猪', '虎', '牛', '龙', '鼠', '蛇']);
});

test('number source selects the latest exact 20-number group inside a module', async () => {
  const numberSource = { key: 'numbers', label: '演示20码', url: 'https://example.test', title: '演示20码', kind: 'numbers', count: 20 };
  const result = await crawlSource(numberSource, {
    fetchHtml: async () => '<div>演示20码 第218期 第219期 第220期 01 03 04 05 07 09 11 16 17 18 21 24 29 30 34 40 41 44 48 49 第221期 第222期 第223期 03 06 08 11 12 13 20 22 23 24 25 29 32 33 35 36 41 44 45 47 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00</div>',
    renderHtml: async () => { throw new Error('browser should not run'); },
    capturedAt: '2026-08-09T11:00:00Z'
  });

  assert.equal(result.status, 'success_http');
  assert.equal(result.periodRange, '221-223期');
  assert.deepEqual(result.numbers, ['03', '06', '08', '11', '12', '13', '20', '22', '23', '24', '25', '29', '32', '33', '35', '36', '41', '44', '45', '47']);
});

test('manual crawl endpoint starts a collection job and returns an accepted response', async () => {
  const records = [{ sourceKey: 'demo', status: 'success_http' }];
  const worker = createWorker({ crawl: async () => records });
  let pending;
  const response = await worker.fetch(new Request('https://example.test/api/combinations/crawl', { method: 'POST' }), {}, {
    waitUntil(promise) { pending = promise; }
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'started', sourceCount: 6 });
  assert.deepEqual(await pending, records);
});
