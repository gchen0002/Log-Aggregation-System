'use client';
import Link from 'next/link';
import { useDashboard } from './DashboardProvider';
import { compact, count, clock, serverDate } from '../lib/events';
import { usePolling } from '../hooks/usePolling';
import type { AlertItem } from '../lib/model';
import TelemetryChart from './TelemetryChart';
import Icon, { IconName } from './Icon';
const throughput = [
    { key: 'acceptedRate' as const, label: 'Accepted', color: '#91aaa0', dashed: true },
    { key: 'indexedRate' as const, label: 'Indexed', color: 'var(--lime)' },
  ],
  backlog = [{ key: 'pending' as const, label: 'Pending', color: 'var(--amber)' }],
  latency = [
    { key: 'p50' as const, label: 'p50', color: '#91aaa0', dashed: true },
    { key: 'p95' as const, label: 'p95', color: 'var(--lime)' },
  ];
export default function OverviewPage() {
  const {
      metrics,
      metricError,
      point,
      stats,
      statsError,
      alertStats,
      detector,
      detectorError,
      history,
      windowSeconds,
      paused,
    } = useDashboard(),
    recent = usePolling<{ alerts: AlertItem[] }>(
      '/api/alerts?limit=1&acknowledged=false',
      10000,
      paused,
    ),
    sources = Object.entries(stats?.bySource ?? {}).sort((a, b) => b[1] - a[1]),
    stale = !detector?.last_poll || Date.now() - serverDate(detector.last_poll).getTime() > 30000;
  const health: [string, IconName, string, string][] = [
    [
      'File agent',
      'file',
      point?.acceptedRate == null
        ? 'Waiting for sample'
        : point.acceptedRate > 0
          ? 'Receiving'
          : 'No recent traffic',
      'Observed at the durable queue',
    ],
    [
      'Durable queue',
      'database',
      metricError || !metrics ? 'Unknown' : metrics.queue.reachable ? 'Available' : 'Unavailable',
      'WAL · synchronous FULL',
    ],
    [
      'Index worker',
      'queue',
      !metrics || metricError
        ? 'Unknown'
        : metrics.ingestion.isRunning
          ? metrics.ingestion.lastError
            ? 'Retrying'
            : 'Processing'
          : 'Stopped',
      'Separate worker thread',
    ],
    [
      'Search API',
      'search',
      !metrics || metricError ? 'Unknown' : 'Available',
      'SQLite FTS5 · cursor pages',
    ],
    [
      'Anomaly detector',
      'bolt',
      detectorError
        ? 'Unavailable'
        : !detector
          ? 'Waiting for detector'
          : stale
            ? 'Stale'
            : 'Running',
      'Asynchronous Python analysis',
    ],
  ];
  return (
    <div className="overview-page">
      <h1 className="sr-only">Overview</h1>
      <div className="metric-grid">
        {[
          [
            'database',
            compact(point?.indexedRate) + '/s',
            'Indexed throughput',
            'Measured unique logs',
          ],
          [
            'queue',
            count(metrics?.queue.pending),
            'Queue backlog',
            metrics?.queue.reachable ? 'Durable, awaiting commit' : 'Queue unavailable',
          ],
          [
            'bolt',
            metrics?.search.p95Ms == null ? '—' : metrics.search.p95Ms.toFixed(1) + ' ms',
            'Search latency p95',
            count(metrics?.search.samples) + ' recent requests',
          ],
          ['bell', count(alertStats?.unacknowledged), 'Open alerts', 'Awaiting acknowledgment'],
        ].map(([icon, value, label, detail]) => (
          <div className="panel metric-card" key={label}>
            <Icon name={icon as IconName} size={25} />
            <div>
              <strong>{value}</strong>
              <span>{label}</span>
              <small>{detail}</small>
            </div>
          </div>
        ))}
      </div>
      <TelemetryChart
        title="Ingestion throughput"
        points={history}
        series={throughput}
        windowSeconds={windowSeconds}
        paused={paused}
      />
      <div className="two-column">
        <TelemetryChart
          title="Queue backlog"
          unit="logs"
          points={history}
          series={backlog}
          windowSeconds={windowSeconds}
          paused={paused}
        />
        <TelemetryChart
          title="Search latency"
          unit="ms"
          points={history}
          series={latency}
          windowSeconds={windowSeconds}
          paused={paused}
        />
      </div>
      <div className="two-column overview-lower">
        <section className="panel">
          <header className="panel-header">
            <h2>Component health</h2>
            <span className="muted">Current observations</span>
          </header>
          <div className="table-scroll">
            <table className="health-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Status</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {health.map(([name, icon, state, detail]) => (
                  <tr key={name}>
                    <td>
                      <Icon name={icon} size={16} />
                      {name}
                    </td>
                    <td>
                      <i
                        className={
                          'status-dot ' +
                          (['Available', 'Receiving', 'Processing', 'Running'].includes(state)
                            ? 'positive'
                            : ['Unavailable', 'Stopped', 'Stale'].includes(state)
                              ? 'warning'
                              : '')
                        }
                      />
                      {state}
                    </td>
                    <td>{detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <header className="panel-header">
            <h2>Sources</h2>
            <span className="muted">Last 24 hours</span>
          </header>
          {statsError ? (
            <p className="quiet-state">Source counts unavailable.</p>
          ) : !stats ? (
            <p className="quiet-state">Loading source counts…</p>
          ) : (
            <div className="source-shares">
              {sources.map(([source, n]) => (
                <Link key={source} href={'/?source=' + encodeURIComponent(source)}>
                  <span>{source}</span>
                  <div className="share-track">
                    <i style={{ width: (stats.total ? (n / stats.total) * 100 : 0) + '%' }} />
                  </div>
                  <span>{stats.total ? ((n / stats.total) * 100).toFixed(1) : '0'}%</span>
                  <strong>{compact(n)}</strong>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      <section className="panel">
        <header className="panel-header">
          <h2>Latest open detection</h2>
          <Link className="text-button" href="/alerts">
            View alerts →
          </Link>
        </header>
        <div className="activity-row">
          {recent.data?.alerts[0] ? (
            <>
              <span className={'severity ' + recent.data.alerts[0].severity}>
                {recent.data.alerts[0].severity}
              </span>
              <span>{recent.data.alerts[0].message}</span>
              <time>{clock(recent.data.alerts[0].createdAt)}</time>
            </>
          ) : (
            <span className="muted">
              {recent.error ? 'Alert data unavailable.' : 'No open detections.'}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
