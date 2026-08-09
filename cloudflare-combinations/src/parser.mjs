const ZODIACS = new Set(['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪']);

export class ValidationError extends Error {}

export function stripHtml(value) {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function sliceModule(html, title) {
  const text = stripHtml(html);
  const escaped = [...String(title)].map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  const match = text.match(new RegExp(escaped));
  const index = match?.index ?? -1;
  if (index < 0) throw new ValidationError(`未找到目标模块：${title}`);
  return text.slice(index, index + 5000);
}

export function parseZodiacs(value) {
  const items = [...String(value)].filter(char => ZODIACS.has(char));
  if (!items.length) throw new ValidationError('未识别到生肖');
  return items;
}

export function parseNumbers(value) {
  const raw = String(value).match(/(?<!\d)\d{1,2}(?!\d)/g) || [];
  return raw.map(item => {
    const number = Number(item);
    if (number < 1 || number > 49) throw new ValidationError('号码必须在01-49之间');
    return String(number).padStart(2, '0');
  });
}

export function parseOddEven(value) {
  const normalized = String(value).replace(/：/g, ':');
  const odd = normalized.match(/单\s*:\s*([^双]+)/)?.[1];
  const even = normalized.match(/双\s*:\s*(.+)$/)?.[1];
  if (!odd || !even) throw new ValidationError('未识别到单双号码');
  return { odd: parseNumbers(odd), even: parseNumbers(even) };
}

export function parsePeriodRange(value) {
  const items = [...String(value).matchAll(/(?:第)?\s*(\d{1,3})\s*期/g)].map(match => Number(match[1]));
  if (!items.length) return '';
  const min = Math.min(...items);
  const max = Math.max(...items);
  return min === max ? `${min}期` : `${min}-${max}期`;
}

export function validateItems(items, { label, kind, count }) {
  if (items.length !== count) throw new ValidationError(`${label}应为${count}个${kind === 'numbers' ? '号码' : '生肖'}`);
  if (new Set(items).size !== items.length) throw new ValidationError(`${label}存在重复${kind === 'numbers' ? '号码' : '生肖'}`);
  return items;
}
