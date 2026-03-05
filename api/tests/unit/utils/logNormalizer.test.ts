import { normalizeLevel } from '../../../src/utils/logNormalizer';

describe('normalizeLevel', () => {
  it('should return "info" for undefined', () => {
    expect(normalizeLevel(undefined)).toBe('info');
  });

  it('should return "info" for empty string', () => {
    expect(normalizeLevel('')).toBe('info');
  });

  describe('debug level', () => {
    it.each(['debug', 'DEBUG', 'Debug', 'dbg', 'DBG'])('should normalize "%s" to "debug"', (input) => {
      expect(normalizeLevel(input)).toBe('debug');
    });
  });

  describe('info level', () => {
    it.each(['info', 'INFO', 'Info', 'information', 'INFORMATION', 'log', 'LOG'])('should normalize "%s" to "info"', (input) => {
      expect(normalizeLevel(input)).toBe('info');
    });
  });

  describe('warn level', () => {
    it.each(['warn', 'WARN', 'Warn', 'warning', 'WARNING'])('should normalize "%s" to "warn"', (input) => {
      expect(normalizeLevel(input)).toBe('warn');
    });
  });

  describe('error level', () => {
    it.each(['error', 'ERROR', 'Error', 'err', 'ERR', 'fatal', 'FATAL', 'critical', 'CRITICAL', 'severe', 'SEVERE'])('should normalize "%s" to "error"', (input) => {
      expect(normalizeLevel(input)).toBe('error');
    });
  });

  it('should return "info" for unknown levels', () => {
    expect(normalizeLevel('verbose')).toBe('info');
    expect(normalizeLevel('trace')).toBe('info');
    expect(normalizeLevel('unknown')).toBe('info');
  });
});
