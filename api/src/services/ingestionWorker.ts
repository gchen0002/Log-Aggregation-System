import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../db/database';
import { LogRepository } from '../db/logRepository';
import { LogEntry } from '../types/log';
import { normalizeLevel } from '../utils/logNormalizer';
const db = openDatabase(workerData.dbPath),
  repo = new LogRepository(db);
db.exec(
  'CREATE TABLE IF NOT EXISTS rejected_logs(id TEXT PRIMARY KEY,payload TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL)',
);
const rejected = db.prepare('INSERT OR IGNORE INTO rejected_logs VALUES(?,?,?,?)');
let stopping = false,
  duplicates = 0,
  lastError: string | null = null;
parentPort!.on('message', (message) => {
  if (message === 'stop') stopping = true;
});
const status = () =>
  parentPort!.postMessage({
    isRunning: !stopping,
    duplicates,
    rejected: (db.prepare('SELECT COUNT(*) n FROM rejected_logs').get() as { n: number }).n,
    lastError,
  });
async function request(route: string, body?: unknown) {
  const res = await fetch(workerData.queueUrl + route, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('Queue HTTP ' + res.status);
  return res.json();
}
function normalize(value: unknown, fallback: string): LogEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a log object');
  const raw = value as Record<string, unknown>;
  if (typeof raw.message !== 'string' || raw.message.length > 10000)
    throw new Error('Invalid message');
  if (raw.source != null && (typeof raw.source !== 'string' || raw.source.length > 500))
    throw new Error('Invalid source');
  if (raw.id != null && (typeof raw.id !== 'string' || !raw.id || raw.id.length > 256))
    throw new Error('Invalid event id');
  const date =
    raw.timestamp == null
      ? new Date()
      : new Date(typeof raw.timestamp === 'number' ? raw.timestamp : String(raw.timestamp));
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid timestamp');
  return {
    id: typeof raw.id === 'string' ? raw.id : createHash('sha256').update(fallback).digest('hex'),
    timestamp: date.toISOString(),
    message: raw.message,
    source: typeof raw.source === 'string' && raw.source ? raw.source : 'unknown',
    level: normalizeLevel(raw.level as string),
    raw: typeof raw.raw === 'string' ? raw.raw : JSON.stringify(raw),
  };
}
async function main() {
  status();
  while (!stopping) {
    try {
      const page = (await request('/api/logs/pending')) as {
        messages?: { id: string; lease: string; logs: unknown[] }[];
      };
      if (!Array.isArray(page.messages)) throw new Error('Invalid queue response');
      for (const batch of page.messages) {
        if (
          typeof batch.id !== 'string' ||
          typeof batch.lease !== 'string' ||
          !Array.isArray(batch.logs) ||
          batch.logs.length > 4096
        )
          throw new Error('Invalid leased batch');
        const entries: LogEntry[] = [];
        const poison: { id: string; payload: string; reason: string }[] = [];
        batch.logs.forEach((value, index) => {
          try {
            entries.push(normalize(value, batch.id + ':' + index));
          } catch (error) {
            poison.push({
              id: batch.id + ':' + index,
              payload: JSON.stringify(value),
              reason: String(error),
            });
          }
        });
        db.transaction(() => {
          const added = repo.insertDeliveredBatch(entries);
          duplicates += entries.length - added;
          for (const row of poison)
            rejected.run(row.id, row.payload, row.reason, new Date().toISOString());
        })();
        // Acknowledgment is fenced by a lease and follows the durable index commit.
        await request('/api/logs/ack', { leases: [{ id: batch.id, lease: batch.lease }] });
      }
      lastError = null;
      status();
      if (page.messages.length === 0) await delay(20);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      status();
      await delay(250);
    }
  }
  db.close();
  parentPort!.close();
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  db.close();
  parentPort!.close();
});
