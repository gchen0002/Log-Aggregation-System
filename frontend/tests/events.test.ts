import { describe, it, expect } from 'vitest';
import {
  serverDate,
  clock,
  rawEvent,
  relatedParams,
  alertSource,
  telemetry,
  numeric,
} from '../src/lib/events';
import type { AlertItem, Metrics } from '../src/lib/model';
const alert: AlertItem = {
  id: 'a',
  logId: 'arbitrary-anchor',
  createdAt: '2026-10-22T16:23:47.123456',
  severity: 'high',
  acknowledged: false,
  message: 'Error rate',
  details: { errors_per_minute: 40, window_minutes: 5 },
};
describe('source-backed event evidence', () => {
  it.each(['2026-10-22T16:23:47.123456', '2026-10-22 16:23:47.123'])(
    'treats %s as UTC, independent of browser timezone',
    (value) => {
      expect(serverDate(value).toISOString()).toBe('2026-10-22T16:23:47.123Z');
      expect(clock(value, true)).toBe(clock('2026-10-22T16:23:47.123Z', true));
    },
  );
  it('preserves explicit UTC offsets and numeric timestamps', () => {
    expect(serverDate('2026-10-22T09:23:47.123-07:00').getTime()).toBe(
      serverDate(alert.createdAt).getTime(),
    );
    expect(serverDate(0).getTime()).toBe(0);
    expect(clock('invalid')).toBe('—');
  });
  it('keeps aggregate scopes independent from the linked log and builds UTC windows', () => {
    expect(alertSource(alert)).toBeNull();
    const p = relatedParams(alert);
    expect(p.get('source')).toBeNull();
    expect(p.get('level')).toBe('error');
    expect(p.get('startDate')).toBe('2026-10-22T16:18:47.123Z');
    expect(p.get('endDate')).toBe('2026-10-22T16:23:48.123Z');
  });
  it('uses the detector observation boundary when it is supplied', () => {
    const p = relatedParams({
      ...alert,
      details: { ...alert.details, window_end: '2026-10-22T16:22:00.000Z' },
    });
    expect(p.get('startDate')).toBe('2026-10-22T16:17:00.000Z');
    expect(p.get('endDate')).toBe('2026-10-22T16:22:00.000Z');
  });
  it('does not treat an anomaly score as an error rate', () => {
    const p = relatedParams({ ...alert, details: { anomaly_score: -0.4, log_source: 'auth' } });
    expect(p.get('source')).toBe('auth');
    expect(p.get('level')).toBeNull();
    expect(numeric({ a: NaN, b: 2 }, 'a', 'b')).toBe(2);
  });
  it('preserves primitive JSON and non-JSON raw evidence', () => {
    const log = {
      id: 'a',
      source: 'auth',
      timestamp: '2026-10-22T00:00:00Z',
      level: 'error',
      message: 'test',
    };
    for (const raw of ['null', '"string"', 'unparsed text'])
      expect(rawEvent({ ...log, raw })).toBe(raw);
  });
  it('keeps missing queue observations unknown and computes rates from elapsed time', () => {
    const m: Metrics = {
      indexedLogs: 100,
      uptimeSeconds: 0,
      ingestion: { isRunning: true },
      queue: { reachable: true, total: 100, acknowledged: 100, pending: 0 },
      search: { samples: 0, p50Ms: null, p95Ms: null },
    };
    const first = telemetry(m, 1000),
      second = telemetry({ ...m, indexedLogs: 500, queue: { reachable: false } }, 3000, first);
    expect(first.indexedRate).toBeNull();
    expect(second.indexedRate).toBe(200);
    expect(second.acceptedRate).toBeNull();
    expect(second.pending).toBeNull();
  });
});
