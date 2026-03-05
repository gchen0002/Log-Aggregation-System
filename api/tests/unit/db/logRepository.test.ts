import { LogRepository } from '../../../src/db/logRepository';
import { createTestDb, createSampleLog, createSampleLogs, cleanupTestDir } from '../../helpers/testDb';
import Database from 'better-sqlite3';

describe('LogRepository', () => {
  let db: Database.Database;
  let repo: LogRepository;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    cleanup = testDb.cleanup;
    repo = new LogRepository(db);
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  describe('initialize', () => {
    it('should create the logs table and FTS index', () => {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('logs', 'logs_fts')"
      ).all() as Array<{ name: string }>;

      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('logs');
      expect(tableNames).toContain('logs_fts');
    });

    it('should create indexes', () => {
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_logs_%'"
      ).all() as Array<{ name: string }>;

      const indexNames = indexes.map(i => i.name);
      expect(indexNames).toContain('idx_logs_timestamp');
      expect(indexNames).toContain('idx_logs_level');
      expect(indexNames).toContain('idx_logs_source');
    });

    it('should be idempotent (safe to call multiple times)', () => {
      // Creating a second repo on the same DB should not throw
      expect(() => new LogRepository(db)).not.toThrow();
    });
  });

  describe('insert', () => {
    it('should insert a single log entry', () => {
      const log = createSampleLog();
      repo.insert(log);

      const result = repo.getById(log.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(log.id);
      expect(result!.message).toBe(log.message);
      expect(result!.level).toBe(log.level);
      expect(result!.source).toBe(log.source);
    });

    it('should store raw field when provided', () => {
      const log = createSampleLog({ raw: '{"original": true}' });
      repo.insert(log);

      const result = repo.getById(log.id);
      expect(result!.raw).toBe('{"original": true}');
    });

    it('should store null for raw when not provided', () => {
      const log = createSampleLog();
      delete log.raw;
      repo.insert(log);

      const result = repo.getById(log.id);
      expect(result!.raw).toBeUndefined();
    });

    it('should throw on duplicate id', () => {
      const log = createSampleLog();
      repo.insert(log);
      expect(() => repo.insert(log)).toThrow();
    });
  });

  describe('insertBatch', () => {
    it('should insert multiple entries in a transaction', () => {
      const logs = createSampleLogs(10);
      const count = repo.insertBatch(logs);

      expect(count).toBe(10);

      for (const log of logs) {
        const result = repo.getById(log.id);
        expect(result).not.toBeNull();
      }
    });

    it('should return 0 for empty array', () => {
      const count = repo.insertBatch([]);
      expect(count).toBe(0);
    });

    it('should roll back entire batch on failure', () => {
      const logs = createSampleLogs(3);
      // Make the third entry have a duplicate ID of the first
      logs[2] = createSampleLog({ id: logs[0].id });

      expect(() => repo.insertBatch(logs)).toThrow();

      // None should be inserted due to transaction rollback
      expect(repo.getById(logs[0].id)).toBeNull();
      expect(repo.getById(logs[1].id)).toBeNull();
    });

    it('should handle large batches', () => {
      const logs = createSampleLogs(500);
      const count = repo.insertBatch(logs);
      expect(count).toBe(500);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      const logs = [
        createSampleLog({ message: 'Connection timeout to database', level: 'error', source: 'api-server', timestamp: '2026-03-01T10:00:00.000Z' }),
        createSampleLog({ message: 'User logged in successfully', level: 'info', source: 'auth-service', timestamp: '2026-03-01T11:00:00.000Z' }),
        createSampleLog({ message: 'Cache miss for key user:123', level: 'debug', source: 'cache-service', timestamp: '2026-03-01T12:00:00.000Z' }),
        createSampleLog({ message: 'High memory usage detected', level: 'warn', source: 'api-server', timestamp: '2026-03-01T13:00:00.000Z' }),
        createSampleLog({ message: 'Database connection restored', level: 'info', source: 'api-server', timestamp: '2026-03-01T14:00:00.000Z' }),
      ];
      repo.insertBatch(logs);
    });

    it('should return all logs with no filters', () => {
      const result = repo.search({});
      expect(result.total).toBe(5);
      expect(result.logs).toHaveLength(5);
    });

    it('should return logs ordered by timestamp descending', () => {
      const result = repo.search({});
      for (let i = 1; i < result.logs.length; i++) {
        expect(result.logs[i - 1].timestamp >= result.logs[i].timestamp).toBe(true);
      }
    });

    it('should filter by level', () => {
      const result = repo.search({ level: 'info' });
      expect(result.total).toBe(2);
      expect(result.logs.every(l => l.level === 'info')).toBe(true);
    });

    it('should filter by source', () => {
      const result = repo.search({ source: 'api-server' });
      expect(result.total).toBe(3);
      expect(result.logs.every(l => l.source === 'api-server')).toBe(true);
    });

    it('should filter by startDate', () => {
      const result = repo.search({ startDate: '2026-03-01T12:00:00.000Z' });
      expect(result.total).toBe(3);
    });

    it('should filter by endDate', () => {
      const result = repo.search({ endDate: '2026-03-01T12:00:00.000Z' });
      expect(result.total).toBe(3);
    });

    it('should filter by date range', () => {
      const result = repo.search({
        startDate: '2026-03-01T11:00:00.000Z',
        endDate: '2026-03-01T13:00:00.000Z'
      });
      expect(result.total).toBe(3);
    });

    it('should do FTS5 full-text search via q parameter', () => {
      const result = repo.search({ q: 'database' });
      expect(result.total).toBe(2); // "Connection timeout to database" + "Database connection restored"
      expect(result.logs.every(l => l.message.toLowerCase().includes('database'))).toBe(true);
    });

    it('should combine FTS5 search with level filter', () => {
      const result = repo.search({ q: 'database', level: 'error' });
      expect(result.total).toBe(1);
      expect(result.logs[0].level).toBe('error');
    });

    it('should handle FTS5 special characters safely', () => {
      // These should not cause SQL errors
      expect(() => repo.search({ q: 'test "quoted"' })).not.toThrow();
      expect(() => repo.search({ q: 'OR AND NOT' })).not.toThrow();
      expect(() => repo.search({ q: 'test*' })).not.toThrow();
    });

    it('should respect limit parameter', () => {
      const result = repo.search({ limit: 2 });
      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(5); // Total should still reflect all matching
    });

    it('should respect offset parameter', () => {
      const allResults = repo.search({});
      const offsetResults = repo.search({ offset: 2 });
      expect(offsetResults.logs).toHaveLength(3);
      expect(offsetResults.logs[0].id).toBe(allResults.logs[2].id);
    });

    it('should clamp limit to 1-1000 range', () => {
      const result = repo.search({ limit: 0 });
      expect(result.logs.length).toBeGreaterThanOrEqual(1);

      const result2 = repo.search({ limit: 5000 });
      expect(result2.logs).toHaveLength(5); // Only 5 in DB, but limit clamped to 1000
    });

    it('should return empty results for non-matching search', () => {
      const result = repo.search({ q: 'nonexistentterm' });
      expect(result.total).toBe(0);
      expect(result.logs).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      const now = new Date();
      const logs = [
        createSampleLog({ level: 'error', source: 'svc-a', timestamp: now.toISOString() }),
        createSampleLog({ level: 'error', source: 'svc-a', timestamp: now.toISOString() }),
        createSampleLog({ level: 'info', source: 'svc-b', timestamp: now.toISOString() }),
        createSampleLog({ level: 'warn', source: 'svc-a', timestamp: now.toISOString() }),
        createSampleLog({ level: 'debug', source: 'svc-c', timestamp: now.toISOString() }),
      ];
      repo.insertBatch(logs);
    });

    it('should return correct totals', () => {
      const stats = repo.getStats(24);
      expect(stats.total).toBe(5);
    });

    it('should break down counts by level', () => {
      const stats = repo.getStats(24);
      expect(stats.byLevel).toEqual({
        error: 2,
        info: 1,
        warn: 1,
        debug: 1
      });
    });

    it('should break down counts by source', () => {
      const stats = repo.getStats(24);
      expect(stats.bySource).toEqual({
        'svc-a': 3,
        'svc-b': 1,
        'svc-c': 1
      });
    });

    it('should filter by time window', () => {
      // Insert an old log
      const oldLog = createSampleLog({
        timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
      });
      repo.insert(oldLog);

      const stats = repo.getStats(24);
      expect(stats.total).toBe(5); // Old log excluded
    });

    it('should clamp hours to minimum of 1', () => {
      const stats = repo.getStats(-10);
      // Should not throw and should use 1 hour minimum
      expect(stats).toBeDefined();
      expect(stats.total).toBeGreaterThanOrEqual(0);
    });

    it('should default to 24 hours', () => {
      const stats = repo.getStats();
      expect(stats.total).toBe(5);
    });
  });

  describe('deleteOldLogs', () => {
    it('should delete logs older than specified days', () => {
      const oldLog = createSampleLog({
        timestamp: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
      });
      const recentLog = createSampleLog({
        timestamp: new Date().toISOString()
      });
      repo.insert(oldLog);
      repo.insert(recentLog);

      const deleted = repo.deleteOldLogs(30);
      expect(deleted).toBe(1);
      expect(repo.getById(oldLog.id)).toBeNull();
      expect(repo.getById(recentLog.id)).not.toBeNull();
    });

    it('should return 0 when no logs to delete', () => {
      const deleted = repo.deleteOldLogs(30);
      expect(deleted).toBe(0);
    });
  });

  describe('getById', () => {
    it('should return a log by ID', () => {
      const log = createSampleLog();
      repo.insert(log);

      const result = repo.getById(log.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(log.id);
    });

    it('should return null for non-existent ID', () => {
      const result = repo.getById('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('getRecent', () => {
    it('should return most recent logs', () => {
      const logs = createSampleLogs(10);
      repo.insertBatch(logs);

      const recent = repo.getRecent(5);
      expect(recent).toHaveLength(5);
      // Should be ordered by timestamp DESC
      for (let i = 1; i < recent.length; i++) {
        expect(recent[i - 1].timestamp >= recent[i].timestamp).toBe(true);
      }
    });

    it('should return empty array when no logs exist', () => {
      const recent = repo.getRecent(5);
      expect(recent).toHaveLength(0);
    });
  });

  describe('getErrorCountSince', () => {
    it('should count errors since a given timestamp', () => {
      const now = new Date();
      const logs = [
        createSampleLog({ level: 'error', timestamp: now.toISOString() }),
        createSampleLog({ level: 'error', timestamp: now.toISOString() }),
        createSampleLog({ level: 'info', timestamp: now.toISOString() }),
        createSampleLog({ level: 'error', timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() }),
      ];
      repo.insertBatch(logs);

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const count = repo.getErrorCountSince(since);
      expect(count).toBe(2); // Only recent errors
    });

    it('should support custom level parameter', () => {
      const now = new Date();
      repo.insert(createSampleLog({ level: 'warn', timestamp: now.toISOString() }));
      repo.insert(createSampleLog({ level: 'warn', timestamp: now.toISOString() }));
      repo.insert(createSampleLog({ level: 'error', timestamp: now.toISOString() }));

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const count = repo.getErrorCountSince(since, 'warn');
      expect(count).toBe(2);
    });

    it('should return 0 when no matching logs', () => {
      const count = repo.getErrorCountSince(new Date().toISOString());
      expect(count).toBe(0);
    });
  });

  describe('FTS5 sync', () => {
    it('should sync inserts to FTS index', () => {
      repo.insert(createSampleLog({ message: 'uniqueftsterm in this log' }));

      const result = repo.search({ q: 'uniqueftsterm' });
      expect(result.total).toBe(1);
    });

    it('should sync deletes from FTS index', () => {
      const log = createSampleLog({
        message: 'deletableftsterm in this log',
        timestamp: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
      });
      repo.insert(log);

      // Verify it's searchable
      expect(repo.search({ q: 'deletableftsterm' }).total).toBe(1);

      // Delete it
      repo.deleteOldLogs(1);

      // Should no longer be searchable
      expect(repo.search({ q: 'deletableftsterm' }).total).toBe(0);
    });
  });
});
