function inRange(capturedAt, days, now) {
  const boundary = new Date(now);
  boundary.setUTCDate(boundary.getUTCDate() - days + 1);
  boundary.setUTCHours(0, 0, 0, 0);
  return new Date(capturedAt) >= boundary;
}

function frequency(records, field) {
  const counts = new Map();
  records.forEach(record => (record[field] || []).forEach(item => counts.set(item, (counts.get(item) || 0) + 1)));
  return [...counts].map(([item, count]) => ({ item, count })).sort((a, b) => b.count - a.count || a.item.localeCompare(b.item, 'zh-CN'));
}

function overlaps(records, field) {
  const sources = new Map();
  records.forEach(record => (record[field] || []).forEach(item => {
    if (!sources.has(item)) sources.set(item, new Set());
    sources.get(item).add(record.sourceKey);
  }));
  return [...sources].filter(([, keys]) => keys.size >= 2).map(([item, keys]) => ({ item, moduleCount: keys.size }))
    .sort((a, b) => b.moduleCount - a.moduleCount || a.item.localeCompare(b.item, 'zh-CN'));
}

export function buildSummary(records, days, now = new Date().toISOString()) {
  const selected = records.filter(record => ['success_http', 'success_browser'].includes(record.status) && inRange(record.capturedAt, days, now));
  return {
    days,
    recordCount: selected.length,
    zodiacFrequency: frequency(selected, 'zodiacs'),
    numberFrequency: frequency(selected, 'numbers'),
    zodiacOverlap: overlaps(selected, 'zodiacs'),
    numberOverlap: overlaps(selected, 'numbers')
  };
}
