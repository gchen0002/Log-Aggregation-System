export interface LogEntry {
  id: string;
  timestamp: string;
  source: string;
  level: string;
  message: string;
  raw?: string;
}
export interface AlertItem {
  id: string;
  logId: string | null;
  severity: string;
  message: string;
  createdAt: string;
  acknowledged: boolean;
  details?: Record<string, unknown>;
}
export interface Metrics {
  indexedLogs: number;
  uptimeSeconds: number;
  ingestion: {
    isRunning: boolean;
    lastError?: string | null;
    duplicates?: number;
    rejected?: number;
  };
  queue: {
    reachable: boolean;
    pending?: number;
    total?: number;
    acknowledged?: number;
    capacity?: number;
  };
  search: { samples: number; p50Ms: number | null; p95Ms: number | null };
}
export interface Point {
  time: number;
  accepted: number | null;
  delivered: number | null;
  indexed: number;
  acceptedRate: number | null;
  indexedRate: number | null;
  pending: number | null;
  p50: number | null;
  p95: number | null;
}
export interface LogPage {
  logs: LogEntry[];
  hasMore: boolean;
  nextCursor: string | null;
}
export interface AlertStats {
  total: number;
  unacknowledged: number;
  bySeverity: Record<string, number>;
  openBySeverity: Record<string, number>;
}
export interface LogStats {
  total: number;
  byLevel: Record<string, number>;
  bySource: Record<string, number>;
}
export interface Detector {
  status: string;
  last_poll: string | null;
  logs_processed: number;
  alerts_created: number;
  detectors: { name: string; enabled: boolean; last_run: string | null; alerts_created: number }[];
}
