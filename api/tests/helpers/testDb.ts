import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { LogEntry, Alert } from '../../src/types/log';

const TEST_DB_DIR = path.join(__dirname, '..', '.test-data');

/**
 * Creates a temporary test database file with a unique name.
 * Returns the database instance and a cleanup function.
 */
export function createTestDb(): { db: Database.Database; cleanup: () => void } {
  if (!fs.existsSync(TEST_DB_DIR)) {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  }

  const dbPath = path.join(TEST_DB_DIR, `test-${uuidv4()}.db`);
  const db = new Database(dbPath);

  const cleanup = (): void => {
    try {
      db.close();
    } catch {
      // Already closed
    }
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // File already removed
    }
  };

  return { db, cleanup };
}

/**
 * Removes the entire test data directory after all tests.
 */
export function cleanupTestDir(): void {
  try {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
  } catch {
    // Best effort
  }
}

/**
 * Creates a sample log entry with optional overrides.
 */
export function createSampleLog(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: uuidv4(),
    message: 'Test log message',
    level: 'info',
    source: 'test-service',
    timestamp: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Creates a sample alert with optional overrides.
 */
export function createSampleAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: uuidv4(),
    logId: uuidv4(),
    severity: 'high',
    message: 'Test alert message',
    createdAt: new Date().toISOString(),
    acknowledged: false,
    ...overrides
  };
}

/**
 * Creates multiple sample log entries at staggered timestamps.
 */
export function createSampleLogs(count: number, overrides: Partial<LogEntry> = {}): LogEntry[] {
  const logs: LogEntry[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    logs.push(createSampleLog({
      timestamp: new Date(now - i * 1000).toISOString(),
      message: `Test log message ${i}`,
      ...overrides
    }));
  }

  return logs;
}
