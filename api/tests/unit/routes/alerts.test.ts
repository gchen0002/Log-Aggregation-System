import express from 'express';
import request from 'supertest';
import { createAlertsRouter } from '../../../src/routes/alerts';
import { AlertRepository } from '../../../src/db/alertRepository';
import { LogRepository } from '../../../src/db/logRepository';
import { AlertService } from '../../../src/services/alertService';
import { createTestDb, createSampleLog, createSampleAlert, cleanupTestDir } from '../../helpers/testDb';
import Database from 'better-sqlite3';

describe('Alerts Routes', () => {
  let db: Database.Database;
  let logRepo: LogRepository;
  let alertRepo: AlertRepository;
  let alertService: AlertService;
  let app: express.Express;
  let cleanup: () => void;

  /**
   * Helper: inserts a log and returns an alert whose logId satisfies FK.
   */
  function createAlertWithLog(overrides: Partial<ReturnType<typeof createSampleAlert>> = {}): ReturnType<typeof createSampleAlert> {
    const log = createSampleLog();
    logRepo.insert(log);
    return createSampleAlert({ logId: log.id, ...overrides });
  }

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    cleanup = testDb.cleanup;
    logRepo = new LogRepository(db);
    alertRepo = new AlertRepository(db);
    db.pragma('foreign_keys = ON');
    alertService = new AlertService(alertRepo, logRepo, { enabled: false });

    app = express();
    app.use(express.json());
    app.use('/api/alerts', createAlertsRouter(alertRepo, alertService));
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  describe('GET /api/alerts', () => {
    beforeEach(() => {
      const alerts = [
        createAlertWithLog({ severity: 'high', acknowledged: false, createdAt: '2026-03-01T10:00:00.000Z' }),
        createAlertWithLog({ severity: 'low', acknowledged: true, createdAt: '2026-03-01T11:00:00.000Z' }),
        createAlertWithLog({ severity: 'critical', acknowledged: false, createdAt: '2026-03-01T12:00:00.000Z' }),
      ];
      for (const alert of alerts) {
        alertRepo.create(alert);
      }
    });

    it('should return all alerts', async () => {
      const res = await request(app)
        .get('/api/alerts')
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.alerts).toHaveLength(3);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);
    });

    it('should filter by severity', async () => {
      const res = await request(app)
        .get('/api/alerts?severity=high')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.alerts[0].severity).toBe('high');
    });

    it('should filter by acknowledged', async () => {
      const res = await request(app)
        .get('/api/alerts?acknowledged=true')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.alerts[0].acknowledged).toBe(true);
    });

    it('should respect limit and offset', async () => {
      const res = await request(app)
        .get('/api/alerts?limit=1&offset=1')
        .expect(200);

      expect(res.body.alerts).toHaveLength(1);
      expect(res.body.total).toBe(3);
    });
  });

  describe('GET /api/alerts/stats', () => {
    it('should return alert statistics and monitoring status', async () => {
      const alert = createAlertWithLog({ severity: 'high', acknowledged: false });
      alertRepo.create(alert);

      const res = await request(app)
        .get('/api/alerts/stats')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.unacknowledged).toBe(1);
      expect(res.body.bySeverity.high).toBe(1);
      expect(res.body.monitoring).toBeDefined();
      expect(res.body.monitoring.config).toBeDefined();
    });

    it('should return zeros for empty database', async () => {
      const res = await request(app)
        .get('/api/alerts/stats')
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.unacknowledged).toBe(0);
    });
  });

  describe('GET /api/alerts/:id', () => {
    it('should return a single alert', async () => {
      const alert = createAlertWithLog();
      alertRepo.create(alert);

      const res = await request(app)
        .get(`/api/alerts/${alert.id}`)
        .expect(200);

      expect(res.body.id).toBe(alert.id);
      expect(res.body.severity).toBe(alert.severity);
    });

    it('should return 404 for non-existent ID', async () => {
      await request(app)
        .get('/api/alerts/nonexistent')
        .expect(404);
    });
  });

  describe('POST /api/alerts/:id/acknowledge', () => {
    it('should acknowledge an alert', async () => {
      const alert = createAlertWithLog({ acknowledged: false });
      alertRepo.create(alert);

      const res = await request(app)
        .post(`/api/alerts/${alert.id}/acknowledge`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.acknowledged).toBe(true);

      // Verify in DB
      const stored = alertRepo.findById(alert.id);
      expect(stored!.acknowledged).toBe(true);
    });

    it('should return 404 for non-existent alert', async () => {
      await request(app)
        .post('/api/alerts/nonexistent/acknowledge')
        .expect(404);
    });
  });

  describe('DELETE /api/alerts', () => {
    it('should delete old acknowledged alerts', async () => {
      const oldAcked = createAlertWithLog({
        acknowledged: true,
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
      });
      alertRepo.create(oldAcked);

      const res = await request(app)
        .delete('/api/alerts?olderThanDays=30')
        .expect(200);

      expect(res.body.deleted).toBe(1);
      expect(res.body.olderThanDays).toBe(30);
    });

    it('should return 400 for olderThanDays <= 0', async () => {
      await request(app)
        .delete('/api/alerts?olderThanDays=-1')
        .expect(400);
    });

    it('should default to 30 days', async () => {
      const res = await request(app)
        .delete('/api/alerts')
        .expect(200);

      expect(res.body.olderThanDays).toBe(30);
    });
  });

  describe('DELETE /api/alerts/acknowledged', () => {
    it('should delete all acknowledged alerts', async () => {
      const acked = createAlertWithLog({ acknowledged: true });
      const unacked = createAlertWithLog({ acknowledged: false });
      alertRepo.create(acked);
      alertRepo.create(unacked);

      const res = await request(app)
        .delete('/api/alerts/acknowledged')
        .expect(200);

      expect(res.body.deleted).toBe(1);
      expect(alertRepo.findById(acked.id)).toBeNull();
      expect(alertRepo.findById(unacked.id)).not.toBeNull();
    });
  });
});
