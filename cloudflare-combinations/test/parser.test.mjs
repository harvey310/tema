import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNumbers, parseOddEven, parseZodiacs, sliceModule, validateItems } from '../src/parser.mjs';

test('parser extracts fixed-width numbers and validates a 20-number combination', () => {
  const numbers = parseNumbers('07 09 11 12 14 15 20 21 23 24 26 33 34 35 36 44 45 46 47 48');
  assert.equal(numbers.length, 20);
  assert.equal(numbers[0], '07');
  validateItems(numbers, { label: '必开20码', kind: 'numbers', count: 20 });
});

test('parser extracts five zodiacs and a loose number', () => {
  assert.deepEqual(parseZodiacs('牛龙兔鼠猪+10.36'), ['牛', '龙', '兔', '鼠', '猪']);
  assert.deepEqual(parseNumbers('牛龙兔鼠猪+10.36'), ['10', '36']);
});

test('parser separates odd and even eight-number groups', () => {
  const result = parseOddEven('单：01.03.09.23.29.35.37.47 双：04.10.20.26.28.30.32.40');
  assert.deepEqual(result.odd, ['01', '03', '09', '23', '29', '35', '37', '47']);
  assert.deepEqual(result.even, ['04', '10', '20', '26', '28', '30', '32', '40']);
});

test('parser rejects a combination with a wrong item count or an out-of-range number', () => {
  assert.throws(() => validateItems(['01', '02'], { label: '16码', kind: 'numbers', count: 16 }), /16码应为16个号码/);
  assert.throws(() => parseNumbers('01 50'), /号码必须在01-49之间/);
});

test('parser locates a module title when HTML comments insert whitespace', () => {
  assert.match(sliceModule('<div>380000.com【三期必开】<!-- 澳门 -->内幕泄密</div>', '380000.com【三期必开】内幕泄密'), /内幕泄密/);
});
