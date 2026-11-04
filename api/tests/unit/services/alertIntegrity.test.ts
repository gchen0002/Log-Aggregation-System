import { createTestDb, createSampleLog } from '../../helpers/testDb';
import { LogRepository } from '../../../src/db/logRepository';
import { AlertRepository } from '../../../src/db/alertRepository';
import { AlertService } from '../../../src/services/alertService';
it('persists a globally scoped threshold alert with a valid log reference and deduplicates real messages', () => {
  const resource = createTestDb();
  resource.db.pragma('foreign_keys=ON');
  const logs = new LogRepository(resource.db),
    alerts = new AlertRepository(resource.db),
    monitor = new AlertService(alerts, logs);
  try {
    logs.insertBatch(Array.from({ length: 60 }, () => createSampleLog({ level: 'error' })));
    logs.insert(createSampleLog({ level: 'error', timestamp: '2099-01-01T00:00:00Z' }));
    monitor.start();
    monitor.stop();
    const page = alerts.findAll({});
    expect(page.total).toBe(1);
    expect(logs.getById(page.alerts[0].logId)?.timestamp).not.toContain('2099');
    expect(page.alerts[0].details?.errorCount).toBe(60);
    expect(page.alerts[0].details?.source).toBeUndefined();
    monitor.start();
    monitor.stop();
    expect(alerts.findAll({}).total).toBe(1);
    expect(resource.db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    monitor.stop();
    resource.cleanup();
  }
});
