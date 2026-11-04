import type { AlertItem, LogEntry, Metrics, Point } from './model';
export function serverDate(value: string | number) {
  return new Date(
    typeof value === 'string' && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(value)
      ? value.replace(' ', 'T') + 'Z'
      : value,
  );
}
export function clock(value: string | number, precise = false) {
  const date = serverDate(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return (
    date.toLocaleTimeString('en-GB', { hour12: false }) +
    (precise ? '.' + String(date.getMilliseconds()).padStart(3, '0') : '')
  );
}
export const count = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '—' : Math.round(value).toLocaleString('en-US');
export const compact = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
        value,
      );
export const numeric = (details: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = details[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
};
export const alertSource = (alert: AlertItem) => {
  const value = alert.details?.source ?? alert.details?.log_source;
  return typeof value === 'string' && value ? value : null;
};
export function alertTitle(alert: AlertItem) {
  const d = alert.details ?? {};
  if (numeric(d, 'errorsPerMinute', 'errors_per_minute') != null)
    return 'Error rate above threshold';
  return d.anomaly_type === 'source_anomaly'
    ? 'Unusual source distribution'
    : d.anomaly_type === 'volume_spike'
      ? 'Log volume above baseline'
      : d.anomaly_type === 'unusual_pattern'
        ? 'Unusual log pattern'
        : alert.message;
}
export function alertValue(alert: AlertItem) {
  const d = alert.details ?? {},
    rate = numeric(d, 'errorsPerMinute', 'errors_per_minute'),
    score = numeric(d, 'anomaly_score');
  return rate != null
    ? rate.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' errors/min'
    : score != null
      ? 'Score ' + score.toFixed(3)
      : null;
}
export function relatedParams(alert: AlertItem) {
  const p = new URLSearchParams(),
    d = alert.details ?? {},
    source = alertSource(alert),
    window = numeric(d, 'windowMinutes', 'window_minutes') ?? 5,
    t = serverDate(typeof d.window_end === 'string' ? d.window_end : alert.createdAt).getTime();
  if (source) p.set('source', source);
  if (Number.isFinite(t)) {
    p.set('startDate', new Date(t - Math.max(1, Math.min(1440, window)) * 60000).toISOString());
    p.set('endDate', new Date(t + (typeof d.window_end === 'string' ? 0 : 1000)).toISOString());
  }
  if (numeric(d, 'errorsPerMinute', 'errors_per_minute') != null) p.set('level', 'error');
  return p;
}
export function eventFields(log: LogEntry): Record<string, unknown> {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(log.raw ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed;
  } catch {}
  return {
    ...Object.fromEntries(
      [...log.message.matchAll(/([\w.-]+)=("[^\"]*"|\S+)/g)].map((m) => [m[1], m[2]]),
    ),
    ...raw,
    id: log.id,
    timestamp: log.timestamp,
    level: log.level,
    source: log.source,
    message: log.message,
  };
}
export function rawEvent(log: LogEntry) {
  if (!log.raw) return JSON.stringify(eventFields(log), null, 2);
  try {
    return JSON.stringify(JSON.parse(log.raw), null, 2);
  } catch {
    return log.raw;
  }
}
export function telemetry(metrics: Metrics, time: number, old?: Point): Point {
  const accepted = metrics.queue.reachable ? (metrics.queue.total ?? null) : null,
    delivered = metrics.queue.reachable ? (metrics.queue.acknowledged ?? null) : null;
  const rate = (a: number | null, b: number | null | undefined) =>
    a != null && b != null && old && a >= b && time > old.time
      ? ((a - b) * 1000) / (time - old.time)
      : null;
  return {
    time,
    accepted,
    delivered,
    indexed: metrics.indexedLogs,
    acceptedRate: rate(accepted, old?.accepted),
    indexedRate: rate(metrics.indexedLogs, old?.indexed),
    pending: metrics.queue.reachable ? (metrics.queue.pending ?? null) : null,
    p50: metrics.search.p50Ms,
    p95: metrics.search.p95Ms,
  };
}
