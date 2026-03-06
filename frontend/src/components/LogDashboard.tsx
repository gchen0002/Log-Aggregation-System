'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface LogEntry {
  id: string;
  message: string;
  level: string;
  source: string;
  timestamp: string;
}

interface LogStats {
  total: number;
  byLevel: Record<string, number>;
  bySource: Record<string, number>;
}

interface AlertItem {
  id: string;
  log_id: string;
  severity: string;
  message: string;
  created_at: string;
  acknowledged: boolean;
}

interface AlertsResponse {
  alerts?: AlertItem[];
}

interface LogsResponse {
  logs?: LogEntry[];
}

const levelAccent: Record<string, string> = {
  debug: '#7dd3fc',
  info: '#7c9cff',
  warn: '#ffbf5a',
  error: '#ff6b7f',
};

const severityAccent: Record<string, string> = {
  low: '#46d6b7',
  medium: '#f2b84b',
  high: '#ff8a5b',
  critical: '#ff5a78',
};

function isLogEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.message === 'string' &&
    typeof entry.level === 'string' &&
    typeof entry.source === 'string' &&
    typeof entry.timestamp === 'string'
  );
}

function isAlertItem(value: unknown): value is AlertItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.message === 'string' &&
    typeof item.severity === 'string' &&
    typeof item.created_at === 'string' &&
    typeof item.acknowledged === 'boolean'
  );
}

function normalizeLogsResponse(payload: unknown): LogEntry[] {
  if (Array.isArray(payload)) {
    return payload.filter(isLogEntry);
  }

  if (payload && typeof payload === 'object') {
    const response = payload as LogsResponse;
    if (Array.isArray(response.logs)) {
      return response.logs.filter(isLogEntry);
    }
  }

  return [];
}

function normalizeStatsResponse(payload: unknown): LogStats {
  if (!payload || typeof payload !== 'object') {
    return { total: 0, byLevel: {}, bySource: {} };
  }

  const stats = payload as Record<string, unknown>;
  return {
    total: typeof stats.total === 'number' ? stats.total : 0,
    byLevel:
      stats.byLevel && typeof stats.byLevel === 'object'
        ? (stats.byLevel as Record<string, number>)
        : {},
    bySource:
      stats.bySource && typeof stats.bySource === 'object'
        ? (stats.bySource as Record<string, number>)
        : {},
  };
}

function normalizeAlertsResponse(payload: unknown): AlertItem[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const response = payload as AlertsResponse;
  if (!Array.isArray(response.alerts)) {
    return [];
  }

  return response.alerts.filter(isAlertItem);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSeries(values: number[]): string {
  if (values.length === 0 || values.every((value) => value === 0)) {
    return '0,56 25,56 50,56 75,56 100,56';
  }

  const max = Math.max(...values, 1);
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 56 - (value / max) * 46;
      return `${x},${y}`;
    })
    .join(' ');
}

export default function LogDashboard() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats>({ total: 0, byLevel: {}, bySource: {} });
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshLogs = useCallback(async (searchQuery: string, searchLevel: string) => {
    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.set('q', searchQuery.trim());
      }
      if (searchLevel) {
        params.set('level', searchLevel);
      }
      params.set('limit', '12');

      const response = await fetch(`${apiUrl}/api/logs?${params.toString()}`);
      const data: unknown = await response.json();
      setLogs(normalizeLogsResponse(data));
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  const refreshOverview = useCallback(async () => {
    try {
      const [statsResponse, alertsResponse] = await Promise.all([
        fetch(`${apiUrl}/api/logs/stats`),
        fetch(`${apiUrl}/api/alerts?limit=5`),
      ]);

      const statsPayload: unknown = await statsResponse.json();
      const alertsPayload: unknown = await alertsResponse.json();

      setStats(normalizeStatsResponse(statsPayload));
      setAlerts(normalizeAlertsResponse(alertsPayload));
    } catch (error) {
      console.error('Failed to fetch overview data:', error);
      setStats({ total: 0, byLevel: {}, bySource: {} });
      setAlerts([]);
    }
  }, [apiUrl]);

  useEffect(() => {
    void refreshLogs('', '');
    void refreshOverview();
  }, [refreshLogs, refreshOverview]);

  const levelCards = useMemo(
    () => ['debug', 'info', 'warn', 'error'].map((item) => ({
      label: item,
      value: stats.byLevel[item] ?? 0,
      color: levelAccent[item] ?? '#94a3b8',
    })),
    [stats.byLevel]
  );

  const busiestSources = useMemo(
    () => Object.entries(stats.bySource)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
    [stats.bySource]
  );

  const sourceSeries = useMemo(
    () => busiestSources.map(([, count]) => count),
    [busiestSources]
  );

  const levelSeries = useMemo(
    () => levelCards.map((item) => item.value),
    [levelCards]
  );

  const totalAlerts = alerts.length;
  const criticalAlerts = alerts.filter((alert) => alert.severity === 'critical').length;
  const errorRate = stats.total > 0 ? Math.round(((stats.byLevel.error ?? 0) / stats.total) * 100) : 0;

  const submitSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await refreshLogs(query, level);
  };

  return (
    <div className="dd-shell">
      <aside className="dd-nav">
        <div className="dd-brand">
          <div className="dd-brand-mark">LA</div>
          <div>
            <strong>Log Atlas</strong>
            <span>Ops Workspace</span>
          </div>
        </div>

        <nav className="dd-nav-list">
          <a className="is-active" href="#overview">Overview</a>
          <a href="#topology">Topology</a>
          <a href="#alerts">Alerts</a>
          <a href="#stream">Log Stream</a>
        </nav>

        <div className="dd-nav-card">
          <span>Cluster Status</span>
          <strong>Healthy</strong>
          <small>API, queue, and anomaly monitoring available</small>
        </div>
      </aside>

      <div className="dd-main">
        <header className="dd-topbar" id="overview">
          <div>
            <span className="dd-kicker">Datastream / production</span>
            <h1>Distributed Log Analytics</h1>
            <p>Centralized observability for pipeline health, alert activity, and live event search.</p>
          </div>

          <div className="dd-topbar-actions">
            <div className="dd-pill">Ingest {formatCount(stats.total)}</div>
            <div className="dd-pill is-accent">Errors {errorRate}%</div>
          </div>
        </header>

        <section className="dd-summary-grid">
          <article className="dd-stat-card">
            <span>Total logs</span>
            <strong>{formatCount(stats.total)}</strong>
            <small>24 hour search window</small>
          </article>
          <article className="dd-stat-card">
            <span>Error volume</span>
            <strong>{formatCount(stats.byLevel.error ?? 0)}</strong>
            <small>Current pressure on services</small>
          </article>
          <article className="dd-stat-card">
            <span>Open alerts</span>
            <strong>{formatCount(totalAlerts)}</strong>
            <small>{formatCount(criticalAlerts)} critical</small>
          </article>
          <article className="dd-stat-card">
            <span>Top source</span>
            <strong>{busiestSources[0]?.[0] ?? 'n/a'}</strong>
            <small>{formatCount(busiestSources[0]?.[1] ?? 0)} events</small>
          </article>
        </section>

        <section className="dd-grid" id="topology">
          <article className="dd-panel dd-panel-large">
            <div className="dd-panel-header">
              <div>
                <h2>Ingestion topology</h2>
                <p>Operational overview inspired by observability control planes.</p>
              </div>
              <span className="dd-badge">Live</span>
            </div>

            <div className="dd-topology">
              <div className="dd-node">
                <strong>Agents</strong>
                <small>File tailers pushing batch payloads</small>
              </div>
              <div className="dd-link" />
              <div className="dd-node">
                <strong>Queue</strong>
                <small>Durable handoff and backpressure</small>
              </div>
              <div className="dd-link" />
              <div className="dd-node is-primary">
                <strong>API + Search</strong>
                <small>SQLite FTS, routing, statistics</small>
              </div>
              <div className="dd-link" />
              <div className="dd-node">
                <strong>Anomaly</strong>
                <small>Statistical and ML detection</small>
              </div>
            </div>

            <div className="dd-mini-charts">
              <div className="dd-chart-card">
                <div className="dd-chart-meta">
                  <span>Level trend</span>
                  <strong>Last snapshot</strong>
                </div>
                <svg viewBox="0 0 100 60" preserveAspectRatio="none">
                  <polyline points={getSeries(levelSeries)} className="dd-line dd-line-indigo" />
                </svg>
              </div>
              <div className="dd-chart-card">
                <div className="dd-chart-meta">
                  <span>Source pressure</span>
                  <strong>Top emitters</strong>
                </div>
                <svg viewBox="0 0 100 60" preserveAspectRatio="none">
                  <polyline points={getSeries(sourceSeries)} className="dd-line dd-line-cyan" />
                </svg>
              </div>
            </div>
          </article>

          <article className="dd-panel">
            <div className="dd-panel-header">
              <div>
                <h2>Log levels</h2>
                <p>Weighted event distribution</p>
              </div>
            </div>

            <div className="dd-bars">
              {levelCards.map((card) => {
                const maxValue = Math.max(...levelCards.map((item) => item.value), 1);
                const height = `${Math.max((card.value / maxValue) * 100, 12)}%`;

                return (
                  <div key={card.label} className="dd-bar-column">
                    <span>{formatCount(card.value)}</span>
                    <div className="dd-bar-track">
                      <div className="dd-bar-fill" style={{ height, backgroundColor: card.color }} />
                    </div>
                    <small>{card.label}</small>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="dd-panel">
            <div className="dd-panel-header">
              <div>
                <h2>Source hotspots</h2>
                <p>Busiest emitters in the index</p>
              </div>
            </div>

            <div className="dd-hotspots">
              {busiestSources.map(([source, count], index) => (
                <div key={source} className="dd-hotspot-row">
                  <span className="dd-hotspot-rank">{index + 1}</span>
                  <div>
                    <strong>{source}</strong>
                    <small>{formatCount(count)} logs</small>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="dd-grid dd-grid-bottom" id="alerts">
          <article className="dd-panel">
            <div className="dd-panel-header">
              <div>
                <h2>Alert feed</h2>
                <p>Most recent alert records</p>
              </div>
            </div>

            <div className="dd-alert-list">
              {alerts.length === 0 ? (
                <div className="dd-empty">No recent alerts.</div>
              ) : (
                alerts.map((alert) => (
                  <div key={alert.id} className="dd-alert-card">
                    <div className="dd-alert-topline">
                      <span
                        className="dd-severity"
                        style={{
                          backgroundColor: `${severityAccent[alert.severity] ?? '#64748b'}22`,
                          color: severityAccent[alert.severity] ?? '#cbd5e1',
                        }}
                      >
                        {alert.severity}
                      </span>
                      <small>{formatTimestamp(alert.created_at)}</small>
                    </div>
                    <p>{alert.message}</p>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="dd-panel dd-panel-wide" id="stream">
            <div className="dd-panel-header dd-panel-header-stack">
              <div>
                <h2>Log stream explorer</h2>
                <p>Fast search over recent logs, styled like a dense monitoring workspace.</p>
              </div>

              <form className="dd-query-bar" onSubmit={submitSearch}>
                <input
                  type="text"
                  placeholder="Search service, message, exception, host"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <select value={level} onChange={(event) => setLevel(event.target.value)}>
                  <option value="">All levels</option>
                  <option value="debug">Debug</option>
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>
                <button type="submit">Query</button>
              </form>
            </div>

            <div className="dd-stream-table">
              <div className="dd-stream-header-row">
                <span>Timestamp</span>
                <span>Level</span>
                <span>Source</span>
                <span>Message</span>
              </div>

              {loading ? (
                <div className="dd-empty">Loading logs...</div>
              ) : logs.length === 0 ? (
                <div className="dd-empty">No logs found for the current query.</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="dd-stream-row">
                    <span className="dd-stream-time">{formatTimestamp(log.timestamp)}</span>
                    <span className="dd-stream-level" style={{ color: levelAccent[log.level] ?? '#cbd5e1' }}>
                      {log.level.toUpperCase()}
                    </span>
                    <span className="dd-stream-source">{log.source}</span>
                    <span className="dd-stream-message">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}
