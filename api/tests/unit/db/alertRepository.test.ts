import { AlertRepository } from '../../../src/db/alertRepository';
import { LogRepository } from '../../../src/db/logRepository';
import { createTestDb, createSampleAlert, createSampleLog, cleanupTestDir } from '../../helpers/testDb';
import Database from 'better-sqlite3';

describe('AlertRepository', () => {
  let db: Database.Database;
  let logRepo: LogRepository;
  let alertRepo: AlertRepository;
  let cleanup: () => void;

  /**
   * Helper: inserts a log and returns an alert sample whose logId
   * points to the newly-inserted log (satisfies FK constraint).
   */
  function createAlertWithLog(overrides: Parameters<typeof createSampleAlert>[0] = {}): ReturnType<typeof createSampleAlert> {
    const log = createSampleLog();
    logRepo.insert(log);
    return createSampleAlert({ logId: log.id, ...overrides });
  }

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    cleanup = testDb.cleanup;
    // LogRepository must be created first to set up the logs table (FK reference)
    logRepo = new LogRepository(db);
    alertRepo = new AlertRepository(db);
    // Enable FK enforcement (better-sqlite3 default is off)
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  describe('initialize', () => {
    it('should create the alerts table with indexes', () => {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'alerts'"
      ).all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);

      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_alerts_%'"
      ).all() as Array<{ name: string }>;
      const indexNames = indexes.map(i => i.name);
      expect(indexNames).toContain('idx_alerts_created');
      expect(indexNames).toContain('idx_alerts_acknowledged');
      expect(indexNames).toContain('idx_alerts_severity');
    });
  });

  describe('create', () => {
    it('should insert an alert', () => {
      const alert = createAlertWithLog();
      alertRepo.create(alert);

      const result = alertRepo.findById(alert.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(alert.id);
      expect(result!.logId).toBe(alert.logId);
      expect(result!.severity).toBe(alert.severity);
      expect(result!.message).toBe(alert.message);
      expect(result!.acknowledged).toBe(false);
    });

    it('should store details as JSON', () => {
      const alert = createAlertWithLog({
        details: { errorCount: 42, type: 'error_rate' }
      });
      alertRepo.create(alert);

      const result = alertRepo.findById(alert.id);
      expect(result!.details).toEqual({ errorCount: 42, type: 'error_rate' });
    });

    it('should handle null details', () => {
      const alert = createAlertWithLog();
      delete alert.details;
      alertRepo.create(alert);

      const result = alertRepo.findById(alert.id);
      expect(result!.details).toBeUndefined();
    });

    it('should throw on duplicate id', () => {
      const alert = createAlertWithLog();
      alertRepo.create(alert);
      expect(() => alertRepo.create(alert)).toThrow();
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      const alerts = [
        createAlertWithLog({ severity: 'high', acknowledged: false, createdAt: '2026-03-01T10:00:00.000Z' }),
        createAlertWithLog({ severity: 'high', acknowledged: true, createdAt: '2026-03-01T11:00:00.000Z' }),
        createAlertWithLog({ severity: 'low', acknowledged: false, createdAt: '2026-03-01T12:00:00.000Z' }),
        createAlertWithLog({ severity: 'critical', acknowledged: false, createdAt: '2026-03-01T13:00:00.000Z' }),
        createAlertWithLog({ severity: 'medium', acknowledged: true, createdAt: '2026-03-01T14:00:00.000Z' }),
      ];
      for (const alert of alerts) {
        alertRepo.create(alert);
      }
    });

    it('should return all alerts with no filter', () => {
      const result = alertRepo.findAll({});
      expect(result.total).toBe(5);
      expect(result.alerts).toHaveLength(5);
    });

    it('should return alerts ordered by created_at descending', () => {
      const result = alertRepo.findAll({});
      for (let i = 1; i < result.alerts.length; i++) {
        expect(result.alerts[i - 1].createdAt >= result.alerts[i].createdAt).toBe(true);
      }
    });

    it('should filter by severity', () => {
      const result = alertRepo.findAll({ severity: 'high' });
      expect(result.total).toBe(2);
      expect(result.alerts.every(a => a.severity === 'high')).toBe(true);
    });

    it('should filter by acknowledged = true', () => {
      const result = alertRepo.findAll({ acknowledged: true });
      expect(result.total).toBe(2);
      expect(result.alerts.every(a => a.acknowledged === true)).toBe(true);
    });

    it('should filter by acknowledged = false', () => {
      const result = alertRepo.findAll({ acknowledged: false });
      expect(result.total).toBe(3);
      expect(result.alerts.every(a => a.acknowledged === false)).toBe(true);
    });

    it('should combine filters', () => {
      const result = alertRepo.findAll({ severity: 'high', acknowledged: false });
      expect(result.total).toBe(1);
    });

    it('should respect limit', () => {
      const result = alertRepo.findAll({ limit: 2 });
      expect(result.alerts).toHaveLength(2);
      expect(result.total).toBe(5);
    });

    it('should respect offset', () => {
      const all = alertRepo.findAll({});
      const offset = alertRepo.findAll({ offset: 3 });
      expect(offset.alerts).toHaveLength(2);
      expect(offset.alerts[0].id).toBe(all.alerts[3].id);
    });

    it('should return empty results when no match', () => {
      const result = alertRepo.findAll({ severity: 'nonexistent' });
      expect(result.total).toBe(0);
      expect(result.alerts).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('should return alert by ID', () => {
      const alert = createAlertWithLog();
      alertRepo.create(alert);
      const result = alertRepo.findById(alert.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(alert.id);
    });

    it('should return null for non-existent ID', () => {
      expect(alertRepo.findById('nonexistent')).toBeNull();
    });
  });

  describe('acknowledge', () => {
    it('should acknowledge an alert', () => {
      const alert = createAlertWithLog({ acknowledged: false });
      alertRepo.create(alert);

      const success = alertRepo.acknowledge(alert.id);
      expect(success).toBe(true);

      const result = alertRepo.findById(alert.id);
      expect(result!.acknowledged).toBe(true);
    });

    it('should return true for already acknowledged alert (idempotent)', () => {
      const alert = createAlertWithLog({ acknowledged: true });
      alertRepo.create(alert);

      const success = alertRepo.acknowledge(alert.id);
      expect(success).toBe(true);
    });

    it('should return false for non-existent alert', () => {
      const success = alertRepo.acknowledge('nonexistent');
      expect(success).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const alerts = [
        createAlertWithLog({ severity: 'high', acknowledged: false }),
        createAlertWithLog({ severity: 'high', acknowledged: true }),
        createAlertWithLog({ severity: 'low', acknowledged: false }),
        createAlertWithLog({ severity: 'critical', acknowledged: false }),
      ];
      for (const a of alerts) alertRepo.create(a);

      const stats = alertRepo.getStats();
      expect(stats.total).toBe(4);
      expect(stats.unacknowledged).toBe(3);
      expect(stats.bySeverity).toEqual({
        high: 2,
        low: 1,
        critical: 1
      });
    });

    it('should return zeros for empty database', () => {
      const stats = alertRepo.getStats();
      expect(stats.total).toBe(0);
      expect(stats.unacknowledged).toBe(0);
      expect(stats.bySeverity).toEqual({});
    });
  });

  describe('deleteOldAlerts', () => {
    it('should only delete old AND acknowledged alerts', () => {
      const oldAcknowledged = createAlertWithLog({
        acknowledged: true,
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
      });
      const oldUnacknowledged = createAlertWithLog({
        acknowledged: false,
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
      });
      const recentAcknowledged = createAlertWithLog({
        acknowledged: true,
        createdAt: new Date().toISOString()
      });

      alertRepo.create(oldAcknowledged);
      alertRepo.create(oldUnacknowledged);
      alertRepo.create(recentAcknowledged);

      const deleted = alertRepo.deleteOldAlerts(30);
      expect(deleted).toBe(1); // Only old + acknowledged

      expect(alertRepo.findById(oldAcknowledged.id)).toBeNull();
      expect(alertRepo.findById(oldUnacknowledged.id)).not.toBeNull();
      expect(alertRepo.findById(recentAcknowledged.id)).not.toBeNull();
    });

    it('should return 0 when nothing to delete', () => {
      const deleted = alertRepo.deleteOldAlerts(30);
      expect(deleted).toBe(0);
    });
  });

  describe('deleteAcknowledged', () => {
    it('should delete all acknowledged alerts regardless of age', () => {
      const acked = createAlertWithLog({ acknowledged: true });
      const unacked = createAlertWithLog({ acknowledged: false });
      alertRepo.create(acked);
      alertRepo.create(unacked);

      const deleted = alertRepo.deleteAcknowledged();
      expect(deleted).toBe(1);
      expect(alertRepo.findById(acked.id)).toBeNull();
      expect(alertRepo.findById(unacked.id)).not.toBeNull();
    });
  });

  describe('findRecentUnacknowledged', () => {
    it('should find matching unacknowledged alert', () => {
      const alert = createAlertWithLog({
        severity: 'high',
        message: 'High error_rate detected: 15.00 errors/minute',
        acknowledged: false,
        createdAt: new Date().toISOString()
      });
      alertRepo.create(alert);

      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const result = alertRepo.findRecentUnacknowledged('high', 'error_rate', since);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(alert.id);
    });

    it('should not find acknowledged alerts', () => {
      const alert = createAlertWithLog({
        severity: 'high',
        message: 'High error_rate detected',
        acknowledged: true,
        createdAt: new Date().toISOString()
      });
      alertRepo.create(alert);

      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const result = alertRepo.findRecentUnacknowledged('high', 'error_rate', since);
      expect(result).toBeNull();
    });

    it('should not find alerts with wrong severity', () => {
      const alert = createAlertWithLog({
        severity: 'low',
        message: 'High error_rate detected',
        acknowledged: false,
        createdAt: new Date().toISOString()
      });
      alertRepo.create(alert);

      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const result = alertRepo.findRecentUnacknowledged('high', 'error_rate', since);
      expect(result).toBeNull();
    });

    it('should not find old alerts', () => {
      const alert = createAlertWithLog({
        severity: 'high',
        message: 'High error_rate detected',
        acknowledged: false,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      });
      alertRepo.create(alert);

      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const result = alertRepo.findRecentUnacknowledged('high', 'error_rate', since);
      expect(result).toBeNull();
    });

    it('should handle LIKE wildcards in pattern safely', () => {
      const alert = createAlertWithLog({
        severity: 'high',
        message: 'Pattern with 100% match_rate',
        acknowledged: false,
        createdAt: new Date().toISOString()
      });
      alertRepo.create(alert);

      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      // Search for literal "100%" - the % should not be treated as wildcard
      const result = alertRepo.findRecentUnacknowledged('high', '100%', since);
      expect(result).not.toBeNull();
    });
  });
});
