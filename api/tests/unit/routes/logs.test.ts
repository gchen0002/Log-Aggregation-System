import express from 'express';
import request from 'supertest';
import { createLogsRouter } from '../../../src/routes/logs';
import { LogRepository } from '../../../src/db/logRepository';
import { createTestDb, createSampleLog, cleanupTestDir } from '../../helpers/testDb';
import Database from 'better-sqlite3';

describe('Logs Routes', () => {
  let db: Database.Database;
  let logRepo: LogRepository;
  let app: express.Express;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    cleanup = testDb.cleanup;
    logRepo = new LogRepository(db);

    app = express();
    app.use(express.json());
    app.use('/api/logs', createLogsRouter(logRepo));
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  describe('POST /api/logs', () => {
    it('should ingest a log entry', async () => {
      const res = await request(app)
        .post('/api/logs')
        .send({ message: 'Test log', level: 'info', source: 'test' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();

      // Verify it was stored
      const stored = logRepo.getById(res.body.id);
      expect(stored).not.toBeNull();
      expect(stored!.message).toBe('Test log');
    });

    it('should return 400 when message is missing', async () => {
      const res = await request(app)
        .post('/api/logs')
        .send({ level: 'info' })
        .expect(400);

      expect(res.body.error).toContain('Message is required');
    });

    it('should return 400 when message is not a string', async () => {
      await request(app)
        .post('/api/logs')
        .send({ message: 123 })
        .expect(400);
    });

    it('should return 400 when message exceeds max length', async () => {
      await request(app)
        .post('/api/logs')
        .send({ message: 'x'.repeat(10001) })
        .expect(400);
    });

    it('should normalize level', async () => {
      const res = await request(app)
        .post('/api/logs')
        .send({ message: 'Test', level: 'WARNING' })
        .expect(201);

      const stored = logRepo.getById(res.body.id);
      expect(stored!.level).toBe('warn');
    });

    it('should default source to "api"', async () => {
      const res = await request(app)
        .post('/api/logs')
        .send({ message: 'Test' })
        .expect(201);

      const stored = logRepo.getById(res.body.id);
      expect(stored!.source).toBe('api');
    });

    it('should validate and normalize timestamp', async () => {
      const res = await request(app)
        .post('/api/logs')
        .send({ message: 'Test', timestamp: '2026-03-01T10:00:00.000Z' })
        .expect(201);

      const stored = logRepo.getById(res.body.id);
      expect(stored!.timestamp).toBe('2026-03-01T10:00:00.000Z');
    });

    it('should use current time for invalid timestamp', async () => {
      const res = await request(app)
        .post('/api/logs')
        .send({ message: 'Test', timestamp: 'not-a-date' })
        .expect(201);

      const stored = logRepo.getById(res.body.id);
      expect(stored!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should store raw field when provided as string', async () => {
      const res = await request(app)
        .post('/api/logs')
        .send({ message: 'Test', raw: '{"original":true}' })
        .expect(201);

      const stored = logRepo.getById(res.body.id);
      expect(stored!.raw).toBe('{"original":true}');
    });
  });

  describe('GET /api/logs', () => {
    beforeEach(() => {
      const logs = [
        createSampleLog({ message: 'Database error', level: 'error', source: 'db-svc', timestamp: '2026-03-01T10:00:00.000Z' }),
        createSampleLog({ message: 'User login', level: 'info', source: 'auth-svc', timestamp: '2026-03-01T11:00:00.000Z' }),
        createSampleLog({ message: 'Cache miss', level: 'debug', source: 'cache-svc', timestamp: '2026-03-01T12:00:00.000Z' }),
      ];
      logRepo.insertBatch(logs);
    });

    it('should return all logs', async () => {
      const res = await request(app)
        .get('/api/logs')
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.logs).toHaveLength(3);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);
    });

    it('should filter by level', async () => {
      const res = await request(app)
        .get('/api/logs?level=error')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.logs[0].level).toBe('error');
    });

    it('should filter by source', async () => {
      const res = await request(app)
        .get('/api/logs?source=auth-svc')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.logs[0].source).toBe('auth-svc');
    });

    it('should search with FTS5', async () => {
      const res = await request(app)
        .get('/api/logs?q=Database')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.logs[0].message).toContain('Database');
    });

    it('should respect limit and offset', async () => {
      const res = await request(app)
        .get('/api/logs?limit=1&offset=1')
        .expect(200);

      expect(res.body.logs).toHaveLength(1);
      expect(res.body.total).toBe(3);
      expect(res.body.limit).toBe(1);
      expect(res.body.offset).toBe(1);
    });

    it('should filter by date range', async () => {
      const res = await request(app)
        .get('/api/logs?startDate=2026-03-01T10:30:00.000Z&endDate=2026-03-01T11:30:00.000Z')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.logs[0].message).toBe('User login');
    });
  });

  describe('GET /api/logs/stats', () => {
    beforeEach(() => {
      const now = new Date();
      const logs = [
        createSampleLog({ level: 'error', source: 'svc-a', timestamp: now.toISOString() }),
        createSampleLog({ level: 'error', source: 'svc-a', timestamp: now.toISOString() }),
        createSampleLog({ level: 'info', source: 'svc-b', timestamp: now.toISOString() }),
      ];
      logRepo.insertBatch(logs);
    });

    it('should return statistics', async () => {
      const res = await request(app)
        .get('/api/logs/stats')
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.byLevel.error).toBe(2);
      expect(res.body.byLevel.info).toBe(1);
      expect(res.body.bySource['svc-a']).toBe(2);
      expect(res.body.hours).toBe(24);
    });

    it('should accept hours parameter', async () => {
      const res = await request(app)
        .get('/api/logs/stats?hours=1')
        .expect(200);

      expect(res.body.hours).toBe(1);
    });
  });

  describe('GET /api/logs/:id', () => {
    it('should return a log by ID', async () => {
      const log = createSampleLog();
      logRepo.insert(log);

      const res = await request(app)
        .get(`/api/logs/${log.id}`)
        .expect(200);

      expect(res.body.id).toBe(log.id);
      expect(res.body.message).toBe(log.message);
    });

    it('should return 404 for non-existent ID', async () => {
      await request(app)
        .get('/api/logs/nonexistent')
        .expect(404);
    });
  });

  describe('DELETE /api/logs', () => {
    it('should delete old logs', async () => {
      const oldLog = createSampleLog({
        timestamp: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
      });
      logRepo.insert(oldLog);

      const res = await request(app)
        .delete('/api/logs?olderThanDays=30')
        .expect(200);

      expect(res.body.deleted).toBe(1);
      expect(res.body.olderThanDays).toBe(30);
    });

    it('should return 400 for olderThanDays <= 0', async () => {
      await request(app)
        .delete('/api/logs?olderThanDays=-1')
        .expect(400);
    });

    it('should default to 30 days', async () => {
      const res = await request(app)
        .delete('/api/logs')
        .expect(200);

      expect(res.body.olderThanDays).toBe(30);
    });
  });
});
