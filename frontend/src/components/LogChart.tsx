'use client';

import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface LogStats {
  total: number;
  byLevel: Record<string, number>;
  bySource: Record<string, number>;
}

interface LogChartProps {
  stats: LogStats;
}

export default function LogChart({ stats }: LogChartProps) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !stats.byLevel) return;

    const data = Object.entries(stats.byLevel).map(([level, count]) => ({
      level,
      count,
    }));

    const width = 400;
    const height = 200;
    const margin = { top: 20, right: 20, bottom: 30, left: 40 };

    d3.select(ref.current).selectAll('*').remove();

    const svg = d3
      .select(ref.current)
      .attr('width', width)
      .attr('height', height);

    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.level))
      .range([margin.left, width - margin.right])
      .padding(0.1);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.count) || 0])
      .nice()
      .range([height - margin.bottom, margin.top]);

    svg
      .selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', (d) => x(d.level) || 0)
      .attr('y', (d) => y(d.count))
      .attr('width', x.bandwidth())
      .attr('height', (d) => height - margin.bottom - y(d.count))
      .attr('fill', 'steelblue');

    svg
      .append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x));

    svg
      .append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y));
  }, [stats]);

  return (
    <div className="border rounded p-4">
      <h2 className="text-lg font-semibold mb-2">Logs by Level</h2>
      <svg ref={ref}></svg>
    </div>
  );
}
