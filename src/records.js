import { HttpError } from "./http-error.js";
import { normalizeRecords } from "./sync.js";

const RECORD_COLUMNS = "year, period, draw_date, normal_1, normal_2, normal_3, normal_4, normal_5, normal_6, special, source_url, created_at, updated_at";
const INSERT_SQL = `INSERT INTO draw_records (
  year, period, draw_date, normal_1, normal_2, normal_3, normal_4, normal_5, normal_6, special, source_url
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function fromRow(row) {
  return {
    year: row.year,
    period: row.period,
    drawDate: row.draw_date,
    balls: [row.normal_1, row.normal_2, row.normal_3, row.normal_4, row.normal_5, row.normal_6, row.special],
    sourceUrl: row.source_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function comparable(record) {
  return JSON.stringify([record.drawDate, ...record.balls]);
}

function insertStatement(db, record, sourceUrl) {
  return db.prepare(INSERT_SQL).bind(
    record.year,
    record.period,
    record.drawDate,
    ...record.balls,
    sourceUrl
  );
}

export async function listRecords(db) {
  const result = await db.prepare(`SELECT ${RECORD_COLUMNS} FROM draw_records WHERE year = 2026 ORDER BY period ASC`).all();
  return (result.results || []).map(fromRow);
}

export async function getStatus(db) {
  const [record, sync] = await Promise.all([
    db.prepare("SELECT COUNT(*) count, MAX(period) latest_period, MAX(draw_date) latest_date FROM draw_records WHERE year = 2026").first(),
    db.prepare("SELECT finished_at, source_url, fetched_count, inserted_count, latest_period FROM sync_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1").first()
  ]);
  return {
    count: Number(record?.count || 0),
    latestPeriod: record?.latest_period || null,
    latestDate: record?.latest_date || null,
    lastSync: sync ? {
      finishedAt: sync.finished_at,
      sourceUrl: sync.source_url,
      fetchedCount: sync.fetched_count,
      insertedCount: sync.inserted_count,
      latestPeriod: sync.latest_period
    } : null
  };
}

export async function insertManualRecord(db, rawRecord) {
  const [record] = normalizeRecords([rawRecord]);
  const existing = await db.prepare("SELECT period FROM draw_records WHERE year = ? AND period = ?")
    .bind(record.year, record.period).first();
  if (existing) throw new HttpError(409, `第 ${record.period} 期已存在，不能覆盖`);
  await insertStatement(db, record, "manual").run();
  return record;
}

export async function syncRecords(db, rawRecords, sourceUrl) {
  const records = normalizeRecords(rawRecords);
  if (!records.length) throw new Error("没有可同步的开奖记录");

  const running = await db.prepare("SELECT id FROM sync_runs WHERE status = 'running' AND started_at >= datetime('now', '-2 minutes') ORDER BY id DESC LIMIT 1").first();
  if (running) throw new HttpError(409, "已有同步任务正在执行，请稍后再试");

  const started = await db.prepare("INSERT INTO sync_runs (source_url, fetched_count, latest_period, status) VALUES (?, ?, ?, 'running')")
    .bind(sourceUrl, records.length, records.at(-1).period).run();
  const syncId = started.meta.last_row_id;

  try {
    const existingResult = await db.prepare(`SELECT ${RECORD_COLUMNS} FROM draw_records WHERE year = 2026 ORDER BY period ASC`).all();
    const existing = new Map((existingResult.results || []).map(row => {
      const record = fromRow(row);
      return [record.period, record];
    }));
    const additions = [];
    for (const record of records) {
      const current = existing.get(record.period);
      if (current && comparable(current) !== comparable(record)) {
        throw new Error(`第 ${record.period} 期历史数据冲突，已拒绝写入`);
      }
      if (!current) additions.push(record);
    }

    const statements = additions.map(record => insertStatement(db, record, sourceUrl));
    statements.push(
      db.prepare("UPDATE sync_runs SET finished_at = CURRENT_TIMESTAMP, inserted_count = ?, status = 'success' WHERE id = ?")
        .bind(additions.length, syncId)
    );
    await db.batch(statements);
    return {
      fetchedCount: records.length,
      insertedCount: additions.length,
      latestPeriod: records.at(-1).period,
      latestDate: records.at(-1).drawDate,
      sourceUrl
    };
  } catch (error) {
    await db.prepare("UPDATE sync_runs SET finished_at = CURRENT_TIMESTAMP, status = 'failed', error_message = ? WHERE id = ?")
      .bind(String(error.message || error).slice(0, 500), syncId).run();
    throw error;
  }
}

export async function recordSyncFailure(db, error) {
  await db.prepare("INSERT INTO sync_runs (finished_at, status, error_message) VALUES (CURRENT_TIMESTAMP, 'failed', ?)")
    .bind(String(error?.message || error).slice(0, 500)).run();
}
