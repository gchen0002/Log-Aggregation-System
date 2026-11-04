'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Point } from '../lib/model';
import { clock, compact } from '../lib/events';
import { ChartKey, linePaths, measuredAverage, niceScale } from '../lib/chart';
export interface Series {
  key: ChartKey;
  label: string;
  color: string;
  dashed?: boolean;
}
export default function TelemetryChart({
  title,
  points,
  series,
  windowSeconds,
  paused = false,
  unit = 'logs/s',
  compact: small = false,
}: {
  title: string;
  points: Point[];
  series: Series[];
  windowSeconds: number;
  paused?: boolean;
  unit?: string;
  compact?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null),
    group = useRef<SVGGElement>(null),
    ticks = useRef<(SVGTextElement | null)[]>([]),
    oldDomain = useRef<[number, number] | null>(null),
    viewDomain = useRef<[number, number]>([0, 1]),
    controls = useRef<{ resume: () => void; finish: () => void } | null>(null);
  const [width, setWidth] = useState(700),
    [hidden, setHidden] = useState<ChartKey[]>([]),
    [inspect, setInspect] = useState<number | null>(null),
    [reduced, setReduced] = useState(false);
  const pauseRef = useRef(paused),
    inspectRef = useRef(inspect),
    reducedRef = useRef(reduced);
  pauseRef.current = paused;
  inspectRef.current = inspect;
  reducedRef.current = reduced;
  const id = useId().replace(/:/g, ''),
    height = small ? 176 : 212,
    left = 44,
    right = 12,
    top = 12,
    bottom = height - 30,
    plotWidth = Math.max(1, width - left - right);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.round(entries[0].contentRect.width)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'),
      update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const visible = useMemo(() => series.filter((s) => !hidden.includes(s.key)), [series, hidden]);
  const model = useMemo(() => {
    const end = points.at(-1)?.time ?? 0,
      cutoff = end - windowSeconds * 1000;
    const data = points.filter((p) => p.time >= cutoff - 10000);
    const valid = data.filter((p) => visible.some((s) => p[s.key] != null));
    const start = Math.max(cutoff, valid[0]?.time ?? end),
      span = end - start;
    const maximum = Math.max(0, ...data.flatMap((p) => visible.map((s) => p[s.key] ?? 0))),
      scale = niceScale(maximum);
    const x = (t: number) => left + ((t - start) / Math.max(1, span)) * plotWidth,
      y = (value: number) => bottom - (value / scale.max) * (bottom - top);
    return {
      data,
      start,
      end,
      span,
      scale,
      y,
      ready: valid.length > 1 && span > 0,
      paths: visible.map((s) => ({ ...s, segments: linePaths(data, s.key, x, y, bottom) })),
    };
  }, [points, windowSeconds, visible, plotWidth, bottom]);
  useEffect(() => {
    if (!model.ready || !group.current) return;
    const node = group.current,
      previous = oldDomain.current;
    oldDomain.current = [model.start, model.end];
    let frame = 0,
      elapsed = 0,
      last = performance.now();
    const previousSpan = previous ? previous[1] - previous[0] : 0;
    const fromScale = previousSpan > 0 ? model.span / previousSpan : 1,
      fromTranslate =
        previousSpan > 0
          ? left * (1 - fromScale) + ((model.start - previous![0]) / previousSpan) * plotWidth
          : 0;
    const duration =
      previous && model.end > previous[1]
        ? Math.min(3000, Math.max(300, model.end - previous[1]))
        : 0;
    const apply = (progress: number) => {
      const scale = fromScale + (1 - fromScale) * progress,
        translate = fromTranslate * (1 - progress);
      node.setAttribute('transform', 'translate(' + translate + ' 0) scale(' + scale + ' 1)');
      const start = model.start + (((left - translate) / scale - left) / plotWidth) * model.span,
        end =
          model.start + (((left + plotWidth - translate) / scale - left) / plotWidth) * model.span;
      viewDomain.current = [start, end];
      ticks.current.forEach((tick, index) => {
        if (tick) tick.textContent = clock(start + ((end - start) * index) / 4);
      });
    };
    const step = (now: number) => {
      if (document.hidden || pauseRef.current || inspectRef.current != null) return;
      elapsed += now - last;
      last = now;
      const progress = duration ? Math.min(1, elapsed / duration) : 1;
      apply(progress);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      last = performance.now();
      if (reducedRef.current) {
        elapsed = duration;
        apply(1);
      } else if (
        !document.hidden &&
        !pauseRef.current &&
        inspectRef.current == null &&
        elapsed < duration
      )
        frame = requestAnimationFrame(step);
    };
    const finish = () => {
      cancelAnimationFrame(frame);
      elapsed = duration;
      apply(1);
    };
    controls.current = { resume, finish };
    apply(previousSpan > 0 && duration > 0 && !reducedRef.current ? 0 : 1);
    if (!duration || reducedRef.current) finish();
    else resume();
    document.addEventListener('visibilitychange', resume);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', resume);
      controls.current = null;
    };
  }, [model, left, plotWidth]);
  useEffect(() => {
    if (reduced) controls.current?.finish();
    else controls.current?.resume();
  }, [paused, inspect, reduced]);
  const current =
      inspect != null ? model.data[Math.min(inspect, model.data.length - 1)] : points.at(-1),
    first = visible[0],
    value = current?.[first?.key],
    format = (n: number | null | undefined) =>
      n == null ? '—' : unit === 'ms' ? n.toFixed(1) : compact(n);
  const choose = (clientX: number) => {
    const rect = container.current!.getBoundingClientRect(),
      [start, end] = viewDomain.current,
      target =
        start + Math.max(0, Math.min(1, (clientX - rect.left - left) / plotWidth)) * (end - start);
    let nearest = 0;
    model.data.forEach((p, i) => {
      if (Math.abs(p.time - target) < Math.abs(model.data[nearest].time - target)) nearest = i;
    });
    setInspect(nearest);
  };
  return (
    <section className={'panel chart ' + (small ? 'compact-chart' : '')} aria-label={title}>
      <div className="chart-heading">
        <div>
          <h2>
            {title} <span>{unit}</span>
          </h2>
          <div className="series-controls">
            {series.map((s) => (
              <button
                key={s.key}
                onClick={() =>
                  setHidden((old) =>
                    old.includes(s.key)
                      ? old.filter((k) => k !== s.key)
                      : visible.length > 1
                        ? [...old, s.key]
                        : old,
                  )
                }
                aria-pressed={!hidden.includes(s.key)}
              >
                <i style={{ background: s.color }} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-readout">
          <strong>{format(value)}</strong>
          <span>{inspect != null && current ? clock(current.time) : 'Latest measured'}</span>
        </div>
      </div>
      <div
        className="chart-plot"
        ref={container}
        tabIndex={0}
        role="region"
        aria-label={'Inspect ' + title}
        onPointerMove={(event) => choose(event.clientX)}
        onPointerLeave={() => setInspect(null)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
          event.preventDefault();
          if (event.key === 'Escape') {
            setInspect(null);
            return;
          }
          setInspect((index) =>
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? model.data.length - 1
                : Math.max(
                    0,
                    Math.min(
                      model.data.length - 1,
                      (index ?? model.data.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1),
                    ),
                  ),
          );
        }}
      >
        {model.ready ? (
          <svg
            width={width}
            height={height}
            viewBox={'0 0 ' + width + ' ' + height}
            aria-hidden="true"
          >
            <defs>
              <clipPath id={'clip' + id}>
                <rect x={left} y={top} width={plotWidth} height={bottom - top} />
              </clipPath>
              {visible.map((s) => (
                <linearGradient id={id + s.key} x1="0" y1="0" x2="0" y2="1" key={s.key}>
                  <stop stopColor={s.color} stopOpacity=".16" />
                  <stop offset="1" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {Array.from({ length: Math.round(model.scale.max / model.scale.step) + 1 }, (_, i) => {
              const n = model.scale.step * i;
              return (
                <g key={i}>
                  <line
                    x1={left}
                    x2={width - right}
                    y1={model.y(n)}
                    y2={model.y(n)}
                    className="grid-line"
                  />
                  <text x={left - 8} y={model.y(n) + 3} textAnchor="end">
                    {compact(n)}
                  </text>
                </g>
              );
            })}
            <g clipPath={'url(#clip' + id + ')'}>
              <g ref={group}>
                {model.paths.map((s) => (
                  <g key={s.key}>
                    {s.segments.map((segment, i) => (
                      <g key={i}>
                        <path d={segment.area} fill={'url(#' + id + s.key + ')'} />
                        <path
                          className="chart-line"
                          d={segment.line}
                          fill="none"
                          stroke={s.color}
                          strokeWidth="1.7"
                          strokeDasharray={s.dashed ? '4 4' : undefined}
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    ))}
                  </g>
                ))}
              </g>
            </g>
            {Array.from({ length: 5 }, (_, i) => (
              <text
                key={i}
                x={left + (plotWidth * i) / 4}
                y={height - 7}
                textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
                ref={(node) => {
                  ticks.current[i] = node;
                }}
              >
                {clock(model.start + (model.span * i) / 4)}
              </text>
            ))}
          </svg>
        ) : (
          <div className="chart-wait" style={{ height }}>
            Collecting measured samples…
          </div>
        )}
        {inspect != null && current && (
          <div className="chart-tooltip" role="status">
            <strong>{clock(current.time, true)}</strong>
            {visible.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />
                {s.label}
                <b>
                  {format(current[s.key])} {unit}
                </b>
              </span>
            ))}
          </div>
        )}
      </div>
      <footer className="chart-footer">
        <span>
          {first
            ? 'Avg ' +
              format(measuredAverage(model.data, first.key)) +
              ' · Peak ' +
              format(Math.max(0, ...model.data.map((p) => p[first.key] ?? 0)))
            : ''}
        </span>
        <span>
          {paused
            ? 'Display paused'
            : inspect != null
              ? 'Inspecting exact observation'
              : 'Hover or use ← → to inspect'}
        </span>
      </footer>
    </section>
  );
}
