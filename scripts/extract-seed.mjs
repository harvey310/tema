import { readFileSync, writeFileSync } from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("用法：node scripts/extract-seed.mjs <input.html> <output.sql>");
}

const html = readFileSync(inputPath, "utf8");
const match = html.match(/const seedCsv = `([\s\S]*?)`;/);
if (!match) throw new Error("未找到 seedCsv");

const lines = match[1].trim().split(/\r?\n/);
const header = lines.shift();
if (header !== "期号,开奖时间,平一,平二,平三,平四,平五,平六,特码") {
  throw new Error("seedCsv 表头不符合要求");
}

const rows = lines.map((line, index) => {
  const cells = line.split(",");
  if (cells.length !== 9) throw new Error(`第 ${index + 1} 条记录不是 9 列`);
  const periodMatch = cells[0].match(/^0*(\d+)期$/);
  if (!periodMatch) throw new Error(`第 ${index + 1} 条期号格式错误`);
  const period = Number(periodMatch[1]);
  if (period !== index + 1) throw new Error(`期号不连续：${cells[0]}`);
  if (!/^2026-\d{2}-\d{2}$/.test(cells[1])) throw new Error(`日期不属于 2026：${cells[1]}`);
  return { period, date: cells[1], balls: cells.slice(2) };
});

if (rows.length !== 220) throw new Error(`预期 220 条，实际 ${rows.length} 条`);

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const sourceUrl = "https://history.macaumarksix.com/history/macaujc2/y/2026";
const statements = rows.map(row => {
  const values = [2026, row.period, sql(row.date), ...row.balls.map(sql), sql(sourceUrl)];
  return `INSERT INTO draw_records (year, period, draw_date, normal_1, normal_2, normal_3, normal_4, normal_5, normal_6, special, source_url) VALUES (${values.join(", ")});`;
});

writeFileSync(outputPath, `${statements.join("\n")}\n`, "utf8");
