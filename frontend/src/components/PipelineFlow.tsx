'use client';
import { useEffect, useRef } from 'react';
import { useDashboard } from './DashboardProvider';
import { compact, count } from '../lib/events';
const routes = [
  'M250 60 H290 Q310 60 310 80 V95 Q310 115 330 115 H370',
  'M580 115 H620 Q640 115 640 95 V80 Q640 60 660 60 H700',
];
export default function PipelineFlow() {
  const { point, metrics, paused } = useDashboard(),
    paths = useRef<(SVGPathElement | null)[]>([]),
    layer = useRef<SVGGElement>(null),
    initial = useRef<(number | null)[]>([null, null]),
    emitted = useRef([0, 0]),
    particles = useRef<{ node: SVGCircleElement; route: number; elapsed: number; ring: boolean }[]>(
      [],
    ),
    pause = useRef(paused);
  pause.current = paused;
  useEffect(() => {
    const counters = [point?.accepted ?? null, point?.delivered ?? null];
    counters.forEach((counter, route) => {
      if (counter == null) return;
      if (initial.current[route] == null || counter < initial.current[route]!) {
        initial.current[route] = counter;
        emitted.current[route] = 0;
        return;
      }
      const total = Math.floor((counter - initial.current[route]!) / 10000),
        added = Math.min(16, Math.max(0, total - emitted.current[route]));
      emitted.current[route] = total;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      for (let i = 0; i < added && particles.current.length < 32; i++) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        node.setAttribute('fill', '#e2e8dc');
        layer.current?.appendChild(node);
        particles.current.push({ node, route, elapsed: -i * 70, ring: false });
      }
    });
  }, [point?.accepted, point?.delivered]);
  useEffect(() => {
    let frame = 0,
      last = performance.now();
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      if (!pause.current && !document.hidden && !media.matches) {
        particles.current = particles.current.filter((p) => {
          p.elapsed += Math.min(dt, 100);
          const path = paths.current[p.route];
          if (!path) return false;
          const t = Math.max(0, Math.min(1, p.elapsed / 1000)),
            point = path.getPointAtLength(path.getTotalLength() * t);
          if (p.elapsed > 1500) {
            p.node.remove();
            return false;
          }
          p.node.setAttribute('cx', String(point.x));
          p.node.setAttribute('cy', String(point.y));
          if (p.elapsed > 1000) {
            const age = (p.elapsed - 1000) / 500;
            p.node.setAttribute('fill', 'none');
            p.node.setAttribute('stroke', '#c5dbb7');
            p.node.setAttribute('stroke-width', '1');
            p.node.setAttribute('r', String(3 + age * 15));
            p.node.setAttribute('opacity', String(1 - age));
          } else {
            p.node.setAttribute('r', String(1.3 + Math.sin(Math.PI * t) * 2.6));
            p.node.setAttribute('opacity', p.elapsed < 0 ? '0' : '.95');
          }
          return true;
        });
      }
      if (!document.hidden) frame = requestAnimationFrame(step);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      last = performance.now();
      if (!document.hidden) frame = requestAnimationFrame(step);
    };
    document.addEventListener('visibilitychange', visibility);
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
      particles.current.forEach((p) => p.node.remove());
      particles.current = [];
    };
  }, []);
  return (
    <section className="pipeline-section" aria-label="Ingestion pipeline">
      <div className="pipeline-legend">● &nbsp;1 dot = 10,000 logs</div>
      <div className="pipeline-scroll">
        <svg
          className="pipeline"
          viewBox="0 0 1000 170"
          role="img"
          aria-label="Measured file agent to durable queue to search index flow"
        >
          {routes.map((d, i) => (
            <path
              d={d}
              key={d}
              ref={(node) => {
                paths.current[i] = node;
              }}
              className="flow-route"
            />
          ))}
          {[
            [
              12,
              12,
              238,
              96,
              'FILE AGENT',
              compact(point?.acceptedRate) + ' logs/s',
              'Accepted into durable storage',
            ],
            [
              370,
              68,
              210,
              96,
              'DURABLE QUEUE',
              count(metrics?.queue.pending) + ' pending',
              metrics?.queue.reachable ? 'Receiving events' : 'Queue unavailable',
            ],
            [
              700,
              12,
              278,
              96,
              'SEARCH INDEX',
              compact(point?.indexedRate) + ' logs/s',
              'Committed, then acknowledged',
            ],
          ].map(([x, y, w, h, title, value, label]) => (
            <g key={title} transform={'translate(' + x + ' ' + y + ')'}>
              <rect width={w} height={h} rx="4" />
              <rect
                x="5"
                y="5"
                width={Number(w) - 10}
                height={Number(h) - 10}
                rx="2"
                className="inner-frame"
              />
              <text x="22" y="26" className="flow-label">
                {title}
              </text>
              <text x="22" y="53" className="flow-value">
                {value}
              </text>
              <text x="22" y="76" className="flow-caption">
                {label}
              </text>
            </g>
          ))}
          {[
            [250, 60],
            [370, 115],
            [580, 115],
            [700, 60],
          ].map(([cx, cy]) => (
            <circle key={cx} cx={cx} cy={cy} r="3" fill="#87988c" />
          ))}
          <g ref={layer} />
        </svg>
      </div>
    </section>
  );
}
