import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { LogEntry, SearchParams } from '../types/log';
export class InvalidCursor extends Error {}
type Position = { time: string; row: number; filter: string };
export function readLogPage(db: Database.Database, params: SearchParams & { cursor?: string }) {
  const filter = createHash('sha256')
    .update(
      JSON.stringify([
        params.q ?? '',
        params.level ?? '',
        params.source ?? '',
        params.startDate ?? '',
        params.endDate ?? '',
      ]),
    )
    .digest('hex')
    .slice(0, 24);
  const conditions: string[] = [],
    values: (string | number)[] = [];
  for (const [key, column] of [
    ['level', 'level'],
    ['source', 'source'],
    ['startDate', 'timestamp >='],
    ['endDate', 'timestamp <='],
  ] as const) {
    const value = params[key];
    if (value) {
      conditions.push(column.includes(' ') ? column + ' ?' : column + ' = ?');
      values.push(value);
    }
  }
  if (params.cursor) {
    let p: Position;
    try {
      if (params.cursor.length > 1024) throw new Error();
      p = JSON.parse(Buffer.from(params.cursor, 'base64url').toString());
      if (
        typeof p.time !== 'string' ||
        !Number.isFinite(Date.parse(p.time)) ||
        !Number.isSafeInteger(p.row) ||
        p.row < 1 ||
        p.filter !== filter
      )
        throw new Error();
    } catch {
      throw new InvalidCursor('Cursor does not match this search.');
    }
    conditions.push('(timestamp < ? OR (timestamp = ? AND rowid < ?))');
    values.push(p.time, p.time, p.row);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '',
    limit = Math.min(Math.max(params.limit || 50, 1), 1000);
  const fields = 'rowid AS cursor_row,id,timestamp,level,source,message,raw';
  let rows: Record<string, unknown>[];
  if (params.q) {
    const phrase = '"' + params.q.replace(/"/g, '""') + '"';
    // Intersect one bounded FTS scan with the latest timestamp-ordered rows.
    // A correlated MATCH per candidate becomes very expensive for sparse phrases.
    // Fall back to the global index when the recent slice cannot fill a page.
    rows = db
      .prepare(
        'WITH recent AS MATERIALIZED (SELECT rowid AS cursor_row,timestamp' +
          ' FROM logs ' +
          where +
          ' ORDER BY timestamp DESC,rowid DESC LIMIT 10000), hits AS (SELECT * FROM recent WHERE cursor_row IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH ? AND rowid >= (SELECT min(cursor_row) FROM recent) AND rowid <= (SELECT max(cursor_row) FROM recent)) ORDER BY timestamp DESC,cursor_row DESC LIMIT ?) SELECT logs.rowid AS cursor_row,logs.* FROM hits JOIN logs ON logs.rowid=hits.cursor_row ORDER BY logs.timestamp DESC,logs.rowid DESC',
      )
      .all(...values, phrase, limit + 1) as Record<string, unknown>[];
    if (rows.length <= limit)
      rows = db
        .prepare(
          'SELECT ' +
            fields +
            ' FROM logs ' +
            where +
            (where ? ' AND ' : ' WHERE ') +
            'rowid IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH ?) ORDER BY timestamp DESC,rowid DESC LIMIT ?',
        )
        .all(...values, phrase, limit + 1) as Record<string, unknown>[];
  } else
    rows = db
      .prepare(
        'SELECT ' + fields + ' FROM logs ' + where + ' ORDER BY timestamp DESC,rowid DESC LIMIT ?',
      )
      .all(...values, limit + 1) as Record<string, unknown>[];
  const hasMore = rows.length > limit,
    page = rows.slice(0, limit),
    last = page.at(-1);
  const logs = page.map(({ cursor_row: _, ...entry }) => ({
    ...entry,
    raw: entry.raw ?? undefined,
  })) as unknown as LogEntry[];
  return {
    logs,
    hasMore,
    nextCursor:
      hasMore && last
        ? Buffer.from(
            JSON.stringify({ time: last.timestamp, row: last.cursor_row, filter }),
          ).toString('base64url')
        : null,
  };
}
