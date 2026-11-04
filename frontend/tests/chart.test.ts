import { describe, it, expect } from 'vitest';
import { niceScale, linePaths, measuredAverage } from '../src/lib/chart';
import type { Point } from '../src/lib/model';
const point = (time: number, indexedRate: number | null): Point => ({
  time,
  indexedRate,
  indexed: 0,
  accepted: null,
  delivered: null,
  acceptedRate: null,
  pending: null,
  p50: null,
  p95: null,
});
describe('measured chart geometry', () => {
  it('preserves zero values and isolates missing observations and long gaps', () => {
    const data = [
      point(0, 0),
      point(1000, 5),
      point(2000, null),
      point(3000, 2),
      point(4000, 3),
      point(20000, 8),
    ];
    expect(
      linePaths(
        data,
        'indexedRate',
        (n) => n,
        (n) => n,
        0,
      ),
    ).toHaveLength(2);
  });
  it('retains spikes and weights rate averages by elapsed time', () => {
    const data = [point(0, 10), point(1000, 100), point(4000, 4)];
    expect(
      linePaths(
        data,
        'indexedRate',
        (n) => n,
        (n) => n,
        0,
      )[0].line,
    ).toContain('100.00');
    expect(measuredAverage(data, 'indexedRate')).toBe(28);
  });
  it('uses a zero baseline with an upper axis that contains every measurement', () => {
    for (const value of [0, 0.001, 12, 40, 1001, 50000]) {
      const scale = niceScale(value);
      expect(scale.max).toBeGreaterThanOrEqual(value);
      expect(scale.step).toBeGreaterThan(0);
    }
  });
});
