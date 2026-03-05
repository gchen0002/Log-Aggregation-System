export interface LogEntry {
  id: string;
  message: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  timestamp: string;
  raw?: string;
}

export interface SearchParams {
  q?: string;
  level?: string;
  source?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface LogStats {
  total: number;
  byLevel: Record<string, number>;
  bySource: Record<string, number>;
}

export interface Alert {
  id: string;
  logId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details?: Record<string, unknown>;
  createdAt: string;
  acknowledged: boolean;
}

export interface AlertFilter {
  severity?: string;
  acknowledged?: boolean;
  limit?: number;
  offset?: number;
}

export interface AlertStats {
  total: number;
  bySeverity: Record<string, number>;
  unacknowledged: number;
}

export interface QueueMessage {
  id: number;
  content: string;
}

export interface QueueStats {
  pending: number;
  total: number;
}
