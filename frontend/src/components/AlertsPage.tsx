'use client';
import { useEffect, useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useDashboard } from './DashboardProvider';
import { requestJson } from '../lib/api';
import type { AlertItem } from '../lib/model';
import { alertSource, alertTitle, alertValue, clock, count, serverDate } from '../lib/events';
import AlertDetail from './AlertDetail';
import AlertRelatedLogs from './AlertRelatedLogs';
import Icon from './Icon';
export default function AlertsPage() {
  const { paused, stats, alertStats, refreshAlerts } = useDashboard();
  const [tab, setTab] = useState('open'),
    [source, setSource] = useState(''),
    [severity, setSeverity] = useState(''),
    [draft, setDraft] = useState(''),
    [q, setQ] = useState(''),
    [offset, setOffset] = useState(0),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [saving, setSaving] = useState<string | null>(null),
    [confirmed, setConfirmed] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const params = new URLSearchParams({ limit: '25', offset: String(offset) });
  if (tab !== 'all') params.set('acknowledged', String(tab === 'acknowledged'));
  if (q) params.set('q', q);
  if (source) params.set('source', source);
  if (severity) params.set('severity', severity);
  const resource = usePolling<{ alerts: AlertItem[]; total: number }>(
      '/api/alerts?' + params,
      5000,
      paused,
    ),
    alerts = resource.data?.alerts ?? [],
    total = resource.data?.total ?? 0,
    selected = alerts.find((alert) => alert.id === selectedId) ?? alerts[0],
    activeId = selected?.id;
  useEffect(() => {
    if (activeId && activeId !== selectedId) setSelectedId(activeId);
  }, [activeId, selectedId]);
  useEffect(() => {
    if (resource.data && offset > 0 && offset >= resource.data.total) {
      setOffset(Math.max(0, Math.floor((resource.data.total - 1) / 25) * 25));
      setSelectedId(null);
    }
  }, [resource.data, offset]);
  const reset = () => {
    setOffset(0);
    setSelectedId(null);
    setError(null);
  };
  async function acknowledge() {
    if (!selected || saving) return;
    const target = selected;
    setSaving(target.id);
    setError(null);
    try {
      await requestJson(
        '/api/alerts/' + encodeURIComponent(target.id) + '/acknowledge',
        undefined,
        { method: 'POST' },
      );
      setConfirmed(target.id);
      resource.refresh();
      refreshAlerts();
    } catch (cause) {
      setError(
        'Detection at ' +
          clock(target.createdAt) +
          ': ' +
          (cause instanceof Error ? cause.message : 'Acknowledgment failed.'),
      );
    } finally {
      setSaving(null);
    }
  }
  return (
    <div className="alerts-page">
      <h1 className="sr-only">Alerts</h1>
      <form
        className="alert-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setQ(draft);
          reset();
        }}
      >
        <div className="search-input">
          <Icon name="search" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search alerts…"
            aria-label="Search alerts"
          />
          {draft && (
            <button
              className="icon-button"
              type="button"
              aria-label="Clear alert search"
              onClick={() => {
                setDraft('');
                setQ('');
                reset();
              }}
            >
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
        <div className="segmented" aria-label="Alert status">
          {[
            ['open', 'Open' + (alertStats ? ' (' + count(alertStats.unacknowledged) + ')' : '')],
            [
              'acknowledged',
              'Acknowledged' +
                (alertStats
                  ? ' (' + count(alertStats.total - alertStats.unacknowledged) + ')'
                  : ''),
            ],
            ['all', 'All'],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={tab === value ? 'selected' : ''}
              aria-pressed={tab === value}
              onClick={() => {
                setTab(value);
                reset();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="Filter alert severity"
          value={severity}
          onChange={(event) => {
            setSeverity(event.target.value);
            reset();
          }}
        >
          <option value="">All severities</option>
          {['critical', 'high', 'medium', 'low'].map((value) => (
            <option key={value} value={value}>
              {value[0].toUpperCase() + value.slice(1)}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter alert source"
          value={source}
          title="Only detector-reported scopes; aggregate alerts appear under All sources"
          onChange={(event) => {
            setSource(event.target.value);
            reset();
          }}
        >
          <option value="">All sources</option>
          {Object.keys(stats?.bySource ?? {})
            .sort()
            .map((value) => (
              <option key={value}>{value}</option>
            ))}
        </select>
        <button className="sr-only" type="submit">
          Search alerts
        </button>
      </form>
      {(error || resource.error) && (
        <div className="inline-error" role="alert">
          {error ?? resource.error}
          <button className="text-button" onClick={resource.refresh}>
            Retry
          </button>
        </div>
      )}
      <div className={'alerts-layout ' + (selected ? 'has-selection' : '')}>
        <section className="panel alert-queue" aria-label="Detected alerts">
          <header className="panel-header">
            <h2>Alerts {resource.data && '(' + count(total) + ')'}</h2>
            <span className="muted">Newest first</span>
          </header>
          <div className="alert-list">
            {alerts.map((alert) => (
              <button
                key={alert.id}
                className={'alert-card ' + (selected?.id === alert.id ? 'selected' : '')}
                aria-pressed={selected?.id === alert.id}
                onClick={() => {
                  setSelectedId(alert.id);
                  if (matchMedia('(max-width: 950px)').matches)
                    requestAnimationFrame(() =>
                      document
                        .getElementById('alert-evidence')
                        ?.scrollIntoView({
                          block: 'start',
                          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                            ? 'auto'
                            : 'smooth',
                        }),
                    );
                }}
              >
                <i className={'severity-dot ' + alert.severity} aria-hidden="true" />
                <div className="alert-card-content">
                  <div className="alert-card-top">
                    <span className={'severity ' + alert.severity}>{alert.severity}</span>
                    <time
                      dateTime={alert.createdAt}
                      title={serverDate(alert.createdAt).toLocaleString()}
                    >
                      {clock(alert.createdAt)}
                    </time>
                  </div>
                  <h2>{alertTitle(alert)}</h2>
                  <div className="alert-card-meta">
                    {alertValue(alert) && <span>{alertValue(alert)}</span>}
                    <span>{alertSource(alert) ?? 'Across sources'}</span>
                  </div>
                  {alert.acknowledged && (
                    <span className="ack-mark">
                      <Icon name="check" size={12} />
                      Acknowledged
                    </span>
                  )}
                </div>
                <Icon name="chevron" size={14} />
              </button>
            ))}
            {!resource.data && resource.loading && (
              <div className="empty-state">Loading alerts…</div>
            )}
            {resource.data && !alerts.length && (
              <div className="empty-state">
                <Icon name="check" size={30} />
                <strong>
                  {q || source || severity
                    ? 'No matching alerts'
                    : tab === 'open'
                      ? 'No open alerts'
                      : 'No alerts here yet'}
                </strong>
                <span>
                  {q || source || severity
                    ? 'Try different filters.'
                    : 'Detections appear here with their supporting evidence.'}
                </span>
              </div>
            )}
          </div>
        </section>
        {selected && (
          <AlertDetail
            key={'evidence:' + selected.id}
            alert={selected}
            saving={saving === selected.id}
            acknowledged={selected.acknowledged || confirmed === selected.id}
            onAcknowledge={() => void acknowledge()}
          />
        )}
        {selected && <AlertRelatedLogs key={'logs:' + selected.id} alert={selected} />}
      </div>
      <footer className="results-footer">
        <span>
          {resource.data
            ? 'Showing ' +
              (total ? offset + 1 : 0) +
              '–' +
              (offset + alerts.length) +
              ' of ' +
              count(total) +
              ' alerts'
            : 'Waiting for alerts'}
        </span>
        <div className="footer-actions">
          <button
            className="button"
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - 25));
              setSelectedId(null);
            }}
          >
            Previous
          </button>
          <button
            className="button"
            disabled={!resource.data || offset + alerts.length >= total}
            onClick={() => {
              setOffset(offset + 25);
              setSelectedId(null);
            }}
          >
            Next
          </button>
        </div>
      </footer>
    </div>
  );
}
