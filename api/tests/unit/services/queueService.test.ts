import nock from 'nock';
import { QueueService } from '../../../src/services/queueService';

describe('QueueService', () => {
  const BASE_URL = 'http://localhost:8081';
  let service: QueueService;

  beforeEach(() => {
    nock.cleanAll();
    // Short timeout + 1 retry for fast tests
    service = new QueueService(BASE_URL, 1000, 1);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  describe('constructor', () => {
    it('should strip trailing slash from baseUrl', () => {
      const svc = new QueueService('http://localhost:8081/');
      // We can verify via the URL used in fetchBatch
      const scope = nock(BASE_URL)
        .get('/api/logs/pending')
        .reply(200, { messages: [] });

      return svc.fetchBatch().then(() => {
        expect(scope.isDone()).toBe(true);
      });
    });
  });

  describe('fetchBatch', () => {
    it('should return parsed messages', async () => {
      nock(BASE_URL)
        .get('/api/logs/pending')
        .reply(200, {
          messages: [
            { id: 1, content: '{"message":"hello"}' },
            { id: 2, content: '{"message":"world"}' }
          ]
        });

      const messages = await service.fetchBatch();
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ id: 1, content: '{"message":"hello"}' });
      expect(messages[1]).toEqual({ id: 2, content: '{"message":"world"}' });
    });

    it('should return empty array when no messages field', async () => {
      nock(BASE_URL)
        .get('/api/logs/pending')
        .reply(200, {});

      const messages = await service.fetchBatch();
      expect(messages).toEqual([]);
    });

    it('should return empty array when messages is not an array', async () => {
      nock(BASE_URL)
        .get('/api/logs/pending')
        .reply(200, { messages: 'not-an-array' });

      const messages = await service.fetchBatch();
      expect(messages).toEqual([]);
    });

    it('should throw on HTTP error after retries exhausted', async () => {
      nock(BASE_URL)
        .get('/api/logs/pending')
        .reply(500, 'Internal Server Error');

      await expect(service.fetchBatch()).rejects.toThrow('HTTP 500');
    });

    it('should throw on connection error after retries exhausted', async () => {
      nock(BASE_URL)
        .get('/api/logs/pending')
        .replyWithError('ECONNREFUSED');

      await expect(service.fetchBatch()).rejects.toThrow('ECONNREFUSED');
    });

    it('should retry on failure before giving up', async () => {
      // Service with 2 retries, minimal delay
      const retryService = new QueueService(BASE_URL, 1000, 2);

      nock(BASE_URL)
        .get('/api/logs/pending')
        .reply(500, 'error')
        .get('/api/logs/pending')
        .reply(200, { messages: [{ id: 1, content: '{"ok":true}' }] });

      const messages = await retryService.fetchBatch();
      expect(messages).toHaveLength(1);
    }, 15000);

    it('should return empty array when messages field is empty', async () => {
      nock(BASE_URL)
        .get('/api/logs/pending')
        .reply(200, { messages: [] });

      const messages = await service.fetchBatch();
      expect(messages).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return queue statistics', async () => {
      nock(BASE_URL)
        .get('/api/queue/stats')
        .reply(200, { pending: 42, total: 1000 });

      const stats = await service.getStats();
      expect(stats).toEqual({ pending: 42, total: 1000 });
    });

    it('should default to zeros for missing fields', async () => {
      nock(BASE_URL)
        .get('/api/queue/stats')
        .reply(200, {});

      const stats = await service.getStats();
      expect(stats).toEqual({ pending: 0, total: 0 });
    });

    it('should return zeros on error (graceful degradation)', async () => {
      nock(BASE_URL)
        .get('/api/queue/stats')
        .replyWithError('ECONNREFUSED');

      const stats = await service.getStats();
      expect(stats).toEqual({ pending: 0, total: 0 });
    });

    it('should return zeros on HTTP error', async () => {
      nock(BASE_URL)
        .get('/api/queue/stats')
        .reply(500, 'Error');

      const stats = await service.getStats();
      expect(stats).toEqual({ pending: 0, total: 0 });
    });
  });
});
