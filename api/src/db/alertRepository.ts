import Database from 'better-sqlite3';
import { Alert, AlertFilter, AlertStats } from '../types/log';

export class AlertRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        log_id TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL,
        acknowledged BOOLEAN DEFAULT 0,
        FOREIGN KEY (log_id) REFERENCES logs(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
      CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged);
      CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
    `);
  }

  create(alert: Alert): void {
    const stmt = this.db.prepare(`
      INSERT INTO alerts (id, log_id, severity, message, details, created_at, acknowledged)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      alert.id,
      alert.logId,
      alert.severity,
      alert.message,
      alert.details ? this.safeStringify(alert.details) : null,
      alert.createdAt,
      alert.acknowledged ? 1 : 0
    );
  }

  findAll(filter: AlertFilter): { alerts: Alert[]; total: number } {
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    const countValues: (string | number)[] = [];

    if (filter.severity) {
      conditions.push('severity = ?');
      values.push(filter.severity);
      countValues.push(filter.severity);
    }

    if (filter.acknowledged !== undefined) {
      conditions.push('acknowledged = ?');
      values.push(filter.acknowledged ? 1 : 0);
      countValues.push(filter.acknowledged ? 1 : 0);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const countQuery = `SELECT COUNT(*) as total FROM alerts ${whereClause}`;
    const countResult = this.db.prepare(countQuery).get(...countValues) as { total: number };
    const total = countResult?.total || 0;

    const limit = Math.min(Math.max(filter.limit || 50, 1), 1000);
    const offset = Math.max(filter.offset || 0, 0);
    
    const query = `
      SELECT id, log_id, severity, message, details, created_at, acknowledged
      FROM alerts
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    values.push(limit, offset);
    
    const rows = this.db.prepare(query).all(...values) as Array<{
      id: string;
      log_id: string;
      severity: string;
      message: string;
      details: string | null;
      created_at: string;
      acknowledged: number;
    }>;

    const alerts: Alert[] = rows.map(row => ({
      id: row.id,
      logId: row.log_id,
      severity: row.severity as Alert['severity'],
      message: row.message,
      details: this.safeParseJson(row.details),
      createdAt: row.created_at,
      acknowledged: Boolean(row.acknowledged)
    }));

    return { alerts, total };
  }

  findById(id: string): Alert | null {
    const row = this.db.prepare(
      'SELECT id, log_id, severity, message, details, created_at, acknowledged FROM alerts WHERE id = ?'
    ).get(id) as {
      id: string;
      log_id: string;
      severity: string;
      message: string;
      details: string | null;
      created_at: string;
      acknowledged: number;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      logId: row.log_id,
      severity: row.severity as Alert['severity'],
      message: row.message,
      details: this.safeParseJson(row.details),
      createdAt: row.created_at,
      acknowledged: Boolean(row.acknowledged)
    };
  }

  acknowledge(id: string): boolean {
    const result = this.db.prepare(
      'UPDATE alerts SET acknowledged = 1 WHERE id = ?'
    ).run(id);
    return result.changes > 0;
  }

  getStats(): AlertStats {
    const totalResult = this.db.prepare(
      'SELECT COUNT(*) as count FROM alerts'
    ).get() as { count: number };
    
    const severityStats = this.db.prepare(
      'SELECT severity, COUNT(*) as count FROM alerts GROUP BY severity'
    ).all() as Array<{ severity: string; count: number }>;
    
    const unacknowledgedResult = this.db.prepare(
      'SELECT COUNT(*) as count FROM alerts WHERE acknowledged = 0'
    ).get() as { count: number };

    const bySeverity: Record<string, number> = {};
    for (const row of severityStats) {
      bySeverity[row.severity] = row.count;
    }

    return {
      total: totalResult.count,
      bySeverity,
      unacknowledged: unacknowledgedResult.count
    };
  }

  deleteOldAlerts(days: number): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    const result = this.db.prepare(
      'DELETE FROM alerts WHERE created_at < ? AND acknowledged = 1'
    ).run(cutoff);
    
    return result.changes;
  }

  deleteAcknowledged(): number {
    const result = this.db.prepare(
      'DELETE FROM alerts WHERE acknowledged = 1'
    ).run();
    
    return result.changes;
  }

  findRecentUnacknowledged(severity: string, pattern: string, since: string): Alert | null {
    // Escape LIKE wildcards and build pattern
    const escapedPattern = pattern.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const likePattern = `%${escapedPattern}%`;
    const row = this.db.prepare(
      `SELECT id FROM alerts 
       WHERE severity = ? AND acknowledged = 0 AND created_at >= ? 
       AND message LIKE ? ESCAPE '\\'
       LIMIT 1`
    ).get(severity, since, likePattern) as { id: string } | undefined;
    
    return row ? this.findById(row.id) : null;
  }

  private safeParseJson(json: string | null): Record<string, unknown> | undefined {
    if (!json) return undefined;
    try {
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private safeStringify(obj: Record<string, unknown>): string | null {
    try {
      return JSON.stringify(obj);
    } catch {
      // Handle circular references by returning null
      return null;
    }
  }
}