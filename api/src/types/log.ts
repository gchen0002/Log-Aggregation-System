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
