import { QueueConsumer } from '../../../src/services/queueConsumer';

// Mock dependencies
const mockLogRepo = {
  insertBatch: jest.fn().mockReturnValue(0),
  getById: jest.fn(),
  insert: jest.fn(),
  search: jest.fn(),
  getStats: jest.fn(),
  getRecent: jest.fn(),
  getErrorCountSince: jest.fn(),
  deleteOldLogs: jest.fn()
};

const mockQueueService = {
  fetchBatch: jest.fn().mockResolvedValue([]),
  getStats: jest.fn().mockResolvedValue({ pending: 0, total: 0 })
};

describe('QueueConsumer', () => {
  let consumer: QueueConsumer;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    // Re-establish defaults after reset
    mockLogRepo.insertBatch.mockReturnValue(0);
    mockQueueService.fetchBatch.mockResolvedValue([]);
    mockQueueService.getStats.mockResolvedValue({ pending: 0, total: 0 });
    consumer = new QueueConsumer(
      mockLogRepo as any,
      mockQueueService as any,
      1000 // 1s poll interval for tests
    );
  });

  afterEach(() => {
    consumer.stop();
    jest.useRealTimers();
  });

  describe('start/stop', () => {
    it('should start and report running status', () => {
      consumer.start();
      expect(consumer.getStatus().isRunning).toBe(true);
    });

    it('should stop and report stopped status', () => {
      consumer.start();
      consumer.stop();
      expect(consumer.getStatus().isRunning).toBe(false);
    });

    it('should be idempotent when starting multiple times', () => {
      consumer.start();
      consumer.start(); // should log "Already running"
      expect(consumer.getStatus().isRunning).toBe(true);
    });

    it('should not throw when stopping without starting', () => {
      expect(() => consumer.stop()).not.toThrow();
    });
  });

  describe('getStatus', () => {
    it('should return initial status', () => {
      const status = consumer.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.consecutiveErrors).toBe(0);
    });
  });

  describe('polling behavior', () => {
    it('should call fetchBatch when started', async () => {
      mockQueueService.fetchBatch.mockResolvedValueOnce([]);
      consumer.start();

      // Allow the first poll to execute
      await jest.advanceTimersByTimeAsync(0);

      expect(mockQueueService.fetchBatch).toHaveBeenCalledTimes(1);
    });

    it('should parse and insert valid messages', async () => {
      mockQueueService.fetchBatch.mockResolvedValueOnce([
        { id: 1, content: JSON.stringify({ message: 'test log', level: 'info', source: 'test' }) },
        { id: 2, content: JSON.stringify({ message: 'another log', level: 'error', source: 'svc' }) }
      ]);
      mockLogRepo.insertBatch.mockReturnValueOnce(2);

      consumer.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockLogRepo.insertBatch).toHaveBeenCalledTimes(1);
      const insertedLogs = mockLogRepo.insertBatch.mock.calls[0][0];
      expect(insertedLogs).toHaveLength(2);
      expect(insertedLogs[0].message).toBe('test log');
      expect(insertedLogs[0].level).toBe('info');
      expect(insertedLogs[1].level).toBe('error');
    });

    it('should skip unparseable messages', async () => {
      mockQueueService.fetchBatch.mockResolvedValueOnce([
        { id: 1, content: 'not valid json' },
        { id: 2, content: JSON.stringify({ message: 'good log' }) }
      ]);
      mockLogRepo.insertBatch.mockReturnValueOnce(1);

      consumer.start();
      await jest.advanceTimersByTimeAsync(0);

      const insertedLogs = mockLogRepo.insertBatch.mock.calls[0][0];
      expect(insertedLogs).toHaveLength(1);
      expect(insertedLogs[0].message).toBe('good log');
    });

    it('should skip previously failed message IDs', async () => {
      // First poll: message 1 fails, message 2 succeeds
      mockQueueService.fetchBatch.mockResolvedValueOnce([
        { id: 1, content: 'invalid json' },
        { id: 2, content: JSON.stringify({ message: 'ok' }) }
      ]);
      mockLogRepo.insertBatch.mockReturnValueOnce(1);

      consumer.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockLogRepo.insertBatch.mock.calls[0][0]).toHaveLength(1);

      // Second poll: message 1 appears again but should be skipped
      mockQueueService.fetchBatch.mockResolvedValueOnce([
        { id: 1, content: 'invalid json' },
        { id: 3, content: JSON.stringify({ message: 'new' }) }
      ]);
      mockLogRepo.insertBatch.mockReturnValueOnce(1);

      await jest.advanceTimersByTimeAsync(1000);

      expect(mockLogRepo.insertBatch.mock.calls[1][0]).toHaveLength(1);
      expect(mockLogRepo.insertBatch.mock.calls[1][0][0].message).toBe('new');
    });

    it('should not call insertBatch when no valid messages remain', async () => {
      mockQueueService.fetchBatch.mockResolvedValueOnce([
        { id: 1, content: 'bad json' }
      ]);

      consumer.start();
      await jest.advanceTimersByTimeAsync(0);

      // insertBatch should not be called since entries array is empty
      expect(mockLogRepo.insertBatch).not.toHaveBeenCalled();
    });

    it('should reset consecutiveErrors on success', async () => {
      // First call fails
      mockQueueService.fetchBatch.mockRejectedValueOnce(new Error('fail'));
      consumer.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(consumer.getStatus().consecutiveErrors).toBe(1);

      // Second call succeeds with messages
      mockQueueService.fetchBatch.mockResolvedValueOnce([
        { id: 1, content: JSON.stringify({ message: 'ok' }) }
      ]);
      mockLogRepo.insertBatch.mockReturnValueOnce(1);

      await jest.advanceTimersByTimeAsync(2000); // backoff: 1000 * 2^1 = 2000
      expect(consumer.getStatus().consecutiveErrors).toBe(0);
    });

    it('should stop after maxConsecutiveErrors', async () => {
      mockQueueService.fetchBatch.mockRejectedValue(new Error('persistent failure'));

      consumer.start();

      // Run through 5 errors (maxConsecutiveErrors = 5)
      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(i === 0 ? 0 : 60000);
      }

      expect(consumer.getStatus().isRunning).toBe(false);
    });

    it('should apply exponential backoff on errors', async () => {
      mockQueueService.fetchBatch
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockResolvedValueOnce([]);

      consumer.start();
      await jest.advanceTimersByTimeAsync(0); // first poll fails

      expect(consumer.getStatus().consecutiveErrors).toBe(1);
      // Next poll should be delayed by baseDelay * 2^1 = 1000 * 2 = 2000ms
    });
  });

  describe('log normalization', () => {
    /**
     * Helper: triggers a single poll cycle with the given messages,
     * waits for it to complete, then returns the logs passed to insertBatch.
     */
    async function pollAndGetInsertedLogs(
      messages: Array<{ id: number; content: string }>,
      expectedCount: number
    ) {
      mockQueueService.fetchBatch.mockResolvedValueOnce(messages);
      mockLogRepo.insertBatch.mockReturnValueOnce(expectedCount);

      consumer.start();
      await jest.advanceTimersByTimeAsync(0);

      // Get the most recent insertBatch call
      const callCount = mockLogRepo.insertBatch.mock.calls.length;
      expect(callCount).toBeGreaterThan(0);
      return mockLogRepo.insertBatch.mock.calls[callCount - 1][0];
    }

    it('should normalize level strings', async () => {
      const logs = await pollAndGetInsertedLogs([
        { id: 10, content: JSON.stringify({ message: 'test', level: 'WARNING' }) },
        { id: 11, content: JSON.stringify({ message: 'test', level: 'err' }) },
        { id: 12, content: JSON.stringify({ message: 'test', level: 'information' }) }
      ], 3);

      expect(logs[0].level).toBe('warn');
      expect(logs[1].level).toBe('error');
      expect(logs[2].level).toBe('info');
    });

    it('should default source to "unknown" when missing', async () => {
      const logs = await pollAndGetInsertedLogs([
        { id: 20, content: JSON.stringify({ message: 'no source' }) }
      ], 1);

      expect(logs[0].source).toBe('unknown');
    });

    it('should use stringified raw object as message when message is missing', async () => {
      const logs = await pollAndGetInsertedLogs([
        { id: 30, content: JSON.stringify({ level: 'info', source: 'test' }) }
      ], 1);

      expect(logs[0].message).toContain('"level":"info"');
    });

    it('should parse numeric timestamps (seconds)', async () => {
      const timestamp = 1709290800; // seconds
      const logs = await pollAndGetInsertedLogs([
        { id: 40, content: JSON.stringify({ message: 'test', timestamp }) }
      ], 1);

      expect(logs[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should parse numeric timestamps (milliseconds)', async () => {
      const timestamp = 1709290800000; // milliseconds
      const logs = await pollAndGetInsertedLogs([
        { id: 50, content: JSON.stringify({ message: 'test', timestamp }) }
      ], 1);

      expect(logs[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should default to current time for invalid timestamp strings', async () => {
      const logs = await pollAndGetInsertedLogs([
        { id: 60, content: JSON.stringify({ message: 'test', timestamp: 'not-a-date' }) }
      ], 1);

      expect(logs[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should default to current time when timestamp is missing', async () => {
      const logs = await pollAndGetInsertedLogs([
        { id: 70, content: JSON.stringify({ message: 'test' }) }
      ], 1);

      expect(logs[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should generate unique IDs for each log entry', async () => {
      const logs = await pollAndGetInsertedLogs([
        { id: 80, content: JSON.stringify({ message: 'a' }) },
        { id: 81, content: JSON.stringify({ message: 'b' }) }
      ], 2);

      expect(logs[0].id).not.toBe(logs[1].id);
      expect(logs[0].id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('should store raw JSON string', async () => {
      const rawObj = { message: 'test', custom: 'field' };
      const logs = await pollAndGetInsertedLogs([
        { id: 90, content: JSON.stringify(rawObj) }
      ], 1);

      expect(JSON.parse(logs[0].raw)).toEqual(rawObj);
    });
  });
});
