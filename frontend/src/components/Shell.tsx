'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDashboard } from './DashboardProvider';
import { compact, count } from '../lib/events';
import Icon, { IconName } from './Icon';
export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname(),
    {
      paused,
      setPaused,
      windowSeconds,
      setWindowSeconds,
      metrics,
      metricError,
      stats,
      alertStats,
      updatedAt,
    } = useDashboard();
  const navigation: [string, string, IconName][] = [
    ['/', 'Explore', 'search'],
    ['/overview', 'Overview', 'grid'],
    ['/alerts', 'Alerts', 'bell'],
  ];
  return (
    <div className="workspace">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside className="sidebar">
        <nav className="primary-nav" aria-label="Primary">
          {navigation.map(([url, label, icon]) => (
            <Link
              className={'nav-item ' + (path === url ? 'active' : '')}
              href={url}
              key={url}
              aria-current={path === url ? 'page' : undefined}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {label === 'Alerts' && !!alertStats?.unacknowledged && (
                <span className="nav-count">{compact(alertStats.unacknowledged)}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sources-heading">
          Sources <span>{Object.keys(stats?.bySource ?? {}).length || '—'}</span>
        </div>
        <nav className="source-nav" aria-label="Log sources">
          {Object.keys(stats?.bySource ?? {})
            .sort()
            .map((source) => (
              <Link
                className="source-link"
                href={'/?source=' + encodeURIComponent(source)}
                key={source}
              >
                <Icon name="box" size={18} />
                <span>{source}</span>
              </Link>
            ))}
        </nav>
        <div className="environment">
          <Icon name="monitor" size={17} />
          <span>Local simulation</span>
          <i className={'status-dot ' + (metricError ? 'danger' : metrics ? 'positive' : '')} />
        </div>
      </aside>
      <div className="main-workspace">
        <header className="topbar">
          <div className="topbar-metrics">
            <div className="inline-metric">
              <Icon name="file" size={23} />
              <div>
                <strong>{compact(metrics?.indexedLogs)}</strong>
                <span>Searchable logs</span>
              </div>
            </div>
            <div className="inline-metric">
              <Icon name="bell" size={23} />
              <div>
                <strong>{count(alertStats?.unacknowledged)}</strong>
                <span>Open alerts</span>
              </div>
            </div>
          </div>
          <div className="topbar-controls">
            <span className="mode-pill">
              <i
                className={
                  'status-dot ' + (metricError ? 'danger' : paused ? '' : metrics ? 'positive' : '')
                }
              />
              {metricError ? 'Offline' : paused ? 'Paused' : updatedAt ? 'Live' : 'Connecting'}
            </span>
            <button
              className="button"
              onClick={() => setPaused(!paused)}
              aria-pressed={paused}
              title="Pause display updates; ingestion continues"
            >
              <Icon name={paused ? 'play' : 'pause'} size={15} />
              {paused ? 'Resume' : 'Pause'}
            </button>
            <select
              aria-label="Chart time window"
              value={windowSeconds}
              onChange={(event) => setWindowSeconds(Number(event.target.value))}
            >
              {[
                [60, '1m'],
                [300, '5m'],
                [900, '15m'],
                [3600, '1h'],
              ].map(([n, label]) => (
                <option value={n} key={n}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </header>
        {metricError && (
          <div className="connection-banner" role="status">
            Telemetry unavailable. {metricError}
          </div>
        )}
        <main id="content" className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
