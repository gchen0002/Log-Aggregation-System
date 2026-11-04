import type { Point } from './model';
export type ChartKey = Exclude<keyof Point, 'time'>;
export function niceScale(value: number) {
  if (value <= 0) return { max: 1, step: 0.25 };
  const base = 10 ** Math.floor(Math.log10(value / 3));
  const step = ([1, 2, 5, 10].find((n) => n * base >= value / 3) ?? 10) * base;
  return { max: Math.ceil(value / step) * step, step };
}
export function measuredAverage(points: Point[], key: ChartKey) {
  let sum = 0,
    weight = 0;
  for (let i = 1; i < points.length; i++) {
    const value = points[i][key],
      dt = points[i].time - points[i - 1].time;
    if (value != null && dt > 0 && dt <= 10000) {
      sum += value * dt;
      weight += dt;
    }
  }
  return weight ? sum / weight : null;
}
export function linePaths(
  points: Point[],
  key: ChartKey,
  x: (n: number) => number,
  y: (n: number) => number,
  baseline: number,
) {
  const segments: { line: string; area: string }[] = [];
  let values: Point[] = [];
  const finish = () => {
    if (values.length > 1) {
      const line = values
        .map((p, i) => (i ? 'L' : 'M') + x(p.time).toFixed(2) + ',' + y(p[key]!).toFixed(2))
        .join(' ');
      segments.push({
        line,
        area:
          line +
          ' L' +
          x(values.at(-1)!.time) +
          ',' +
          baseline +
          ' L' +
          x(values[0].time) +
          ',' +
          baseline +
          ' Z',
      });
    }
    values = [];
  };
  for (const p of points) {
    if (
      p[key] == null ||
      !Number.isFinite(p[key]) ||
      (values.length && p.time - values.at(-1)!.time > 10000)
    )
      finish();
    if (p[key] != null && Number.isFinite(p[key])) values.push(p);
  }
  finish();
  return segments;
}
