import Database from 'better-sqlite3';
import { LogEntry, SearchParams, LogStats } from '../types/log';

export class LogRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        raw TEXT
      );
      
      CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(
        message,
        source,
        content='logs',
        content_rowid='rowid'
      );
      
      CREATE TRIGGER IF NOT EXISTS logs_fts_insert AFTER INSERT ON logs BEGIN
        INSERT INTO logs_fts(rowid, message, source) 
        VALUES (new.rowid, new.message, new.source);
      END;
      
      CREATE TRIGGER IF NOT EXISTS logs_fts_delete AFTER DELETE ON logs BEGIN
        INSERT INTO logs_fts(logs_fts, rowid, message, source) 
        VALUES ('delete', old.rowid, old.message, old.source);
      END;
      
      CREATE TRIGGER IF NOT EXISTS logs_fts_update AFTER UPDATE ON logs BEGIN
        INSERT INTO logs_fts(logs_fts, rowid, message, source) 
        VALUES ('delete', old.rowid, old.message, old.source);
        INSERT INTO logs_fts(rowid, message, source) 
        VALUES (new.rowid, new.message, new.source);
      END;
      
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
      CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source);
    `);
  }

  insert(entry: LogEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO logs (id, timestamp, level, source, message, raw)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.id,
      entry.timestamp,
      entry.level,
      entry.source,
      entry.message,
      entry.raw || null
    );
  }

  insertBatch(entries: LogEntry[]): number {
    if (entries.length === 0) return 0;

    const insertStmt = this.db.prepare(`
      INSERT INTO logs (id, timestamp, level, source, message, raw)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const transaction = this.db.transaction((items: LogEntry[]) => {
      for (const entry of items) {
        insertStmt.run(
          entry.id,
          entry.timestamp,
          entry.level,
          entry.source,
          entry.message,
          entry.raw || null
        );
      }
      return items.length;
    });
    
    return transaction(entries);
  }

  search(params: SearchParams): { logs: LogEntry[]; total: number } {
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    const countValues: (string | number)[] = [];

    if (params.q) {
      // Escape FTS5 query syntax by wrapping in double quotes (literal phrase search)
      // Double quotes inside the query are escaped by doubling them
      const safeQuery = '"' + params.q.replace(/"/g, '""') + '"';
      conditions.push(`logs.rowid IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH ?)`);
      values.push(safeQuery);
      countValues.push(safeQuery);
    }

    if (params.level) {
      conditions.push('logs.level = ?');
      values.push(params.level);
      countValues.push(params.level);
    }

    if (params.source) {
      conditions.push('logs.source = ?');
      values.push(params.source);
      countValues.push(params.source);
    }

    if (params.startDate) {
      conditions.push('logs.timestamp >= ?');
      values.push(params.startDate);
      countValues.push(params.startDate);
    }

    if (params.endDate) {
      conditions.push('logs.timestamp <= ?');
      values.push(params.endDate);
      countValues.push(params.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // Build count query using same conditions but without limit/offset
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM logs 
      ${whereClause}
    `;
    
    const countResult = this.db.prepare(countQuery).get(...countValues) as { total: number };
    const total = countResult?.total || 0;

    const limit = Math.min(Math.max(params.limit || 50, 1), 1000);
    const offset = Math.max(params.offset || 0, 0);
    
    const query = `
      SELECT id, timestamp, level, source, message, raw
      FROM logs
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;
    
    values.push(limit, offset);
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...values) as Array<{
      id: string;
      timestamp: string;
      level: string;
      source: string;
      message: string;
      raw: string | null;
    }>;

    const logs: LogEntry[] = rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      level: row.level as LogEntry['level'],
      source: row.source,
      message: row.message,
      raw: row.raw || undefined
    }));

    return { logs, total };
  }

  getStats(hours: number = 24): LogStats {
    // Clamp hours to a reasonable range (1 hour to 1 year)
    const clampedHours = Math.min(Math.max(hours, 1), 8760);
    const since = new Date(Date.now() - clampedHours * 60 * 60 * 1000).toISOString();
    
    const totalResult = this.db.prepare(
      'SELECT COUNT(*) as count FROM logs WHERE timestamp >= ?'
    ).get(since) as { count: number };
    
    const levelStats = this.db.prepare(
      'SELECT level, COUNT(*) as count FROM logs WHERE timestamp >= ? GROUP BY level'
    ).all(since) as Array<{ level: string; count: number }>;
    
    const sourceStats = this.db.prepare(
      'SELECT source, COUNT(*) as count FROM logs WHERE timestamp >= ? GROUP BY source ORDER BY count DESC LIMIT 100'
    ).all(since) as Array<{ source: string; count: number }>;

    const byLevel: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    for (const row of levelStats) {
      byLevel[row.level] = row.count;
    }

    for (const row of sourceStats) {
      bySource[row.source] = row.count;
    }

    return {
      total: totalResult.count,
      byLevel,
      bySource
    };
  }

  deleteOldLogs(days: number): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    const result = this.db.prepare(
      'DELETE FROM logs WHERE timestamp < ?'
    ).run(cutoff);
    
    return result.changes;
  }

  getById(id: string): LogEntry | null {
    const row = this.db.prepare(
      'SELECT id, timestamp, level, source, message, raw FROM logs WHERE id = ?'
    ).get(id) as {
      id: string;
      timestamp: string;
      level: string;
      source: string;
      message: string;
      raw: string | null;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      timestamp: row.timestamp,
      level: row.level as LogEntry['level'],
      source: row.source,
      message: row.message,
      raw: row.raw || undefined
    };
  }

  getRecent(limit: number): LogEntry[] {
    const rows = this.db.prepare(
      'SELECT id, timestamp, level, source, message, raw FROM logs ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as Array<{
      id: string;
      timestamp: string;
      level: string;
      source: string;
      message: string;
      raw: string | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      level: row.level as LogEntry['level'],
      source: row.source,
      message: row.message,
      raw: row.raw || undefined
    }));
  }

  getErrorCountSince(since: string, level: string = 'error'): number {
    const result = this.db.prepare(
      'SELECT COUNT(*) as count FROM logs WHERE level = ? AND timestamp >= ?'
    ).get(level, since) as { count: number };
    
    return result.count;
  }
}