import { AlertService } from '../../../src/services/alertService';

const mockAlertRepo = {
  create: jest.fn(),
  findById: jest.fn(),
  findAll: jest.fn(),
  acknowledge: jest.fn(),
  getStats: jest.fn(),
  deleteOldAlerts: jest.fn(),
  deleteAcknowledged: jest.fn(),
  findRecentUnacknowledged: jest.fn().mockReturnValue(null)
};

const mockLogRepo = {
  insert: jest.fn(),
  insertBatch: jest.fn(),
  search: jest.fn(),
  getById: jest.fn(),
  getRecent: jest.fn(),
  getStats: jest.fn(),
  deleteOldLogs: jest.fn(),
  getErrorCountSince: jest.fn().mockReturnValue(0)
};

describe('AlertService', () => {
  let service: AlertService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    service = new AlertService(
      mockAlertRepo as any,
      mockLogRepo as any,
      {
        errorRate: { errorsPerMinute: 10, windowMinutes: 5 },
        enabled: true
      }
    );
  });

  afterEach(() => {
    service.stop();
    jest.useRealTimers();
  });

  describe('start/stop', () => {
    it('should start and report running status', () => {
      service.start();
      expect(service.getStatus().isRunning).toBe(true);
    });

    it('should stop and report stopped status', () => {
      service.start();
      service.stop();
      expect(service.getStatus().isRunning).toBe(false);
    });

    it('should not start when disabled', () => {
      const disabled = new AlertService(
        mockAlertRepo as any,
        mockLogRepo as any,
        { enabled: false }
      );
      disabled.start();
      expect(disabled.getStatus().isRunning).toBe(false);
    });

    it('should be idempotent when starting multiple times', () => {
      service.start();
      service.start(); // should not throw or create duplicate intervals
      expect(service.getStatus().isRunning).toBe(true);
    });

    it('should not throw when stopping without starting', () => {
      expect(() => service.stop()).not.toThrow();
    });
  });

  describe('threshold checking', () => {
    it('should create alert when error rate exceeds threshold', async () => {
      // 60 errors in 5 minutes = 12 errors/min > threshold of 10
      mockLogRepo.getErrorCountSince.mockReturnValue(60);
      mockAlertRepo.findRecentUnacknowledged.mockReturnValue(null);

      service.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockAlertRepo.create).toHaveBeenCalledTimes(1);
      const alert = mockAlertRepo.create.mock.calls[0][0];
      expect(alert.severity).toBe('high');
      expect(alert.message).toContain('error rate');
      expect(alert.details.errorsPerMinute).toBe(12);
      expect(alert.details.type).toBe('error_rate');
    });

    it('should NOT create alert when error rate is below threshold', async () => {
      // 40 errors in 5 minutes = 8 errors/min < threshold of 10
      mockLogRepo.getErrorCountSince.mockReturnValue(40);

      service.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockAlertRepo.create).not.toHaveBeenCalled();
    });

    it('should NOT create duplicate alert if recent unacknowledged exists', async () => {
      mockLogRepo.getErrorCountSince.mockReturnValue(60);
      mockAlertRepo.findRecentUnacknowledged.mockReturnValue({
        id: 'existing-alert',
        severity: 'high',
        message: 'existing'
      });

      service.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockAlertRepo.create).not.toHaveBeenCalled();
    });

    it('should skip check when windowMinutes is <= 0', async () => {
      const badConfig = new AlertService(
        mockAlertRepo as any,
        mockLogRepo as any,
        { errorRate: { errorsPerMinute: 10, windowMinutes: 0 }, enabled: true }
      );

      badConfig.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockLogRepo.getErrorCountSince).not.toHaveBeenCalled();
      badConfig.stop();
    });

    it('should check periodically when running', async () => {
      mockLogRepo.getErrorCountSince.mockReturnValue(0);

      service.start();
      await jest.advanceTimersByTimeAsync(0); // first check

      expect(mockLogRepo.getErrorCountSince).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(60000); // after 1 minute
      expect(mockLogRepo.getErrorCountSince).toHaveBeenCalledTimes(2);
    });
  });

  describe('createAlert', () => {
    it('should create an alert with auto-generated id and timestamp', () => {
      const result = service.createAlert({
        logId: 'log-123',
        severity: 'critical',
        message: 'Manual alert',
        acknowledged: false
      });

      expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.severity).toBe('critical');
      expect(result.message).toBe('Manual alert');
      expect(mockAlertRepo.create).toHaveBeenCalledWith(result);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const config = service.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.errorRate.errorsPerMinute).toBe(10);
      expect(config.errorRate.windowMinutes).toBe(5);

      // Verify it's a copy (mutating returned config should not affect service)
      config.errorRate.errorsPerMinute = 999;
      expect(service.getConfig().errorRate.errorsPerMinute).toBe(10);
    });
  });

  describe('updateConfig', () => {
    it('should update enabled flag', () => {
      service.updateConfig({ enabled: false });
      expect(service.getConfig().enabled).toBe(false);
    });

    it('should deep merge errorRate config', () => {
      service.updateConfig({ errorRate: { errorsPerMinute: 20 } as any });
      const config = service.getConfig();
      expect(config.errorRate.errorsPerMinute).toBe(20);
      // windowMinutes should be preserved
      expect(config.errorRate.windowMinutes).toBe(5);
    });

    it('should not modify config when called with empty object', () => {
      const before = service.getConfig();
      service.updateConfig({});
      const after = service.getConfig();
      expect(after).toEqual(before);
    });
  });

  describe('getStatus', () => {
    it('should return complete status', () => {
      const status = service.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.lastCheck).toBeInstanceOf(Date);
      expect(status.config).toBeDefined();
      expect(status.config.errorRate).toBeDefined();
    });
  });
});
