import type { LogEntry } from '../types/log';

export function normalizeLevel(level: string | undefined): LogEntry['level'] {
  if (!level) return 'info';

  const normalized = level.toLowerCase();
  
  if (['debug', 'dbg'].includes(normalized)) return 'debug';
  if (['info', 'information', 'log'].includes(normalized)) return 'info';
  if (['warn', 'warning'].includes(normalized)) return 'warn';
  if (['error', 'err', 'fatal', 'critical', 'severe'].includes(normalized)) return 'error';
  
  return 'info';
}
