'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDashboard } from './DashboardProvider';
import { usePolling } from '../hooks/usePolling';
import { requestJson } from '../lib/api';
import type { LogEntry, LogPage } from '../lib/model';
import { clock, count, serverDate } from '../lib/events';
import Icon from './Icon';
import PipelineFlow from './PipelineFlow';
import TelemetryChart from './TelemetryChart';
import LogInspector from './LogInspector';
const series = [{ key: 'indexedRate' as const, label: 'Indexed', color: 'var(--lime)' }];
export default function ExplorePage() {
  const router = useRouter(),
    search = useSearchParams(),
    searchString = search.toString(),
    { paused, history, windowSeconds, stats } = useDashboard();
  const q = search.get('q') ?? '',
    level = search.get('level') ?? '',
    source = search.get('source') ?? '',
    selectedId = search.get('logId'),
    [draft, setDraft] = useState(q),
    [filters, setFilters] = useState(false),
    [pipeline, setPipeline] = useState(true);
  const limit = [25, 50, 100].includes(Number(search.get('limit')))
    ? Number(search.get('limit'))
    : 50;
  const params = new URLSearchParams({ limit: String(limit) });
  for (const key of ['q', 'level', 'source', 'startDate', 'endDate']) {
    const value = search.get(key);
    if (value) params.set(key, value);
  }
  const key = params.toString();
  const [snapshot, setSnapshot] = useState<{
      key: string;
      logs: LogEntry[];
      cursor: string | null;
    } | null>(null),
    [loadingOlder, setLoadingOlder] = useState(false),
    [pageError, setPageError] = useState<string | null>(null),
    abort = useRef<AbortController | null>(null);
  const frozen = snapshot?.key === key,
    resource = usePolling<LogPage>('/api/logs/page?' + key, 2000, paused || frozen),
    historical = usePolling<LogEntry>(
      selectedId ? '/api/logs/' + encodeURIComponent(selectedId) : null,
      0,
      paused,
    );
  const logs = frozen ? snapshot.logs : (resource.data?.logs ?? []),
    cursor = frozen ? snapshot.cursor : resource.data?.nextCursor,
    selected = logs.find((log) => log.id === selectedId) ?? historical.data,
    index = logs.findIndex((log) => log.id === selectedId);
  const update = useCallback(
    (values: Record<string, string | null>) => {
      const next = new URLSearchParams(searchString);
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      router.replace('/?' + next, { scroll: false });
    },
    [router, searchString],
  );
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    if (q === draft) return;
    const timer = setTimeout(() => update({ q: draft, logId: null }), 300);
    return () => clearTimeout(timer);
  }, [draft, q, update]);
  useEffect(() => {
    setPageError(null);
    setLoadingOlder(false);
    return () => abort.current?.abort();
  }, [key]);
  const close = useCallback(() => update({ logId: null }), [update]);
  async function older() {
    if (!cursor || loadingOlder) return;
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setLoadingOlder(true);
    setPageError(null);
    try {
      const query = new URLSearchParams(key);
      query.set('cursor', cursor);
      const page = await requestJson<LogPage>('/api/logs/page?' + query, controller.signal);
      if (!controller.signal.aborted) {
        const seen = new Set(logs.map((log) => log.id));
        setSnapshot({
          key,
          logs: [...logs, ...page.logs.filter((log) => !seen.has(log.id))],
          cursor: page.nextCursor,
        });
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setPageError(error instanceof Error ? error.message : 'Could not load older logs.');
    } finally {
      if (!controller.signal.aborted) setLoadingOlder(false);
    }
  }
  return (
    <div className="explore-page">
      <h1 className="sr-only">Explore logs</h1>
      <div className="section-tools">
        <button
          className="text-button"
          aria-expanded={pipeline}
          onClick={() => setPipeline(!pipeline)}
        >
          Ingestion pipeline <Icon name="chevron" size={13} />
        </button>
      </div>
      {pipeline && <PipelineFlow />}
      <TelemetryChart
        title="Event volume"
        unit="logs/s"
        points={history}
        series={series}
        windowSeconds={windowSeconds}
        paused={paused}
        compact
      />
      <form
        className="search-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: draft, logId: null });
        }}
      >
        <div className="search-input">
          <Icon name="search" />
          <input
            placeholder="Search logs…"
            aria-label="Search logs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          {draft && (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear search"
              onClick={() => {
                setDraft('');
                update({ q: null, logId: null });
              }}
            >
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
        <div className="segmented" aria-label="Log level">
          {['', 'info', 'warn', 'error'].map((value) => (
            <button
              type="button"
              aria-pressed={level === value}
              className={level === value ? 'selected' : ''}
              key={value}
              onClick={() => update({ level: value, logId: null })}
            >
              {value ? value[0].toUpperCase() + value.slice(1) : 'All'}
            </button>
          ))}
        </div>
        <select
          aria-label="Filter log source"
          value={source}
          onChange={(event) => update({ source: event.target.value, logId: null })}
        >
          <option value="">All sources</option>
          {[...new Set([...Object.keys(stats?.bySource ?? {}), ...(source ? [source] : [])])]
            .sort()
            .map((value) => (
              <option key={value}>{value}</option>
            ))}
        </select>
        <button
          type="button"
          className={'button ' + (filters ? 'active' : '')}
          aria-expanded={filters}
          onClick={() => setFilters(!filters)}
        >
          More filters
        </button>
      </form>
      {filters && (
        <form
          className="time-filters panel"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget),
              start = String(form.get('start') ?? ''),
              end = String(form.get('end') ?? '');
            if (start && end && new Date(start) > new Date(end)) {
              setPageError('Start time must precede end time.');
              return;
            }
            update({
              startDate: start ? new Date(start).toISOString() : null,
              endDate: end ? new Date(end).toISOString() : null,
              logId: null,
            });
          }}
        >
          <label>
            From <input type="datetime-local" name="start" />
          </label>
          <label>
            Until <input type="datetime-local" name="end" />
          </label>
          <button className="button">Apply time range</button>
          <button
            type="button"
            className="text-button"
            onClick={() => update({ startDate: null, endDate: null, logId: null })}
          >
            Clear range
          </button>
        </form>
      )}
      {(search.get('startDate') || search.get('endDate')) && (
        <p className="search-context">
          Detection window:{' '}
          {search.get('startDate')
            ? serverDate(search.get('startDate')!).toLocaleString()
            : 'Any time'}{' '}
          → {search.get('endDate') ? serverDate(search.get('endDate')!).toLocaleString() : 'Now'}
        </p>
      )}
      {(resource.error || pageError) && (
        <div role="alert" className="inline-error">
          {pageError ?? resource.error}
          <button className="text-button" onClick={resource.refresh}>
            Retry
          </button>
        </div>
      )}
      <div className={'explorer-layout ' + (selected ? 'with-inspector' : '')}>
        <section className="panel log-table-panel" aria-label="Log results">
          <div className="table-scroll">
            <table className="log-table">
              <thead>
                <tr>
                  <th scope="col">Time ↓</th>
                  <th scope="col">Level</th>
                  <th scope="col">Source</th>
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className={selected?.id === log.id ? 'selected' : ''}
                    onClick={() => update({ logId: log.id })}
                  >
                    <td>
                      <button
                        className="log-select"
                        aria-label={
                          'Inspect ' +
                          log.level +
                          ' event from ' +
                          log.source +
                          ' at ' +
                          clock(log.timestamp, true)
                        }
                        aria-pressed={selected?.id === log.id}
                        onClick={() => update({ logId: log.id })}
                      >
                        <time
                          dateTime={log.timestamp}
                          title={serverDate(log.timestamp).toLocaleString()}
                        >
                          {clock(log.timestamp, true)}
                        </time>
                      </button>
                    </td>
                    <td>
                      <span className={'level ' + log.level}>{log.level.toUpperCase()}</span>
                    </td>
                    <td>{log.source}</td>
                    <td className="message-cell" title={log.message}>
                      {log.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!resource.data && resource.loading && <div className="empty-state">Loading logs…</div>}
            {resource.data && logs.length === 0 && (
              <div className="empty-state">
                <Icon name="search" size={30} />
                <strong>No logs match this search</strong>
                <span>Try another phrase, source, or time range.</span>
              </div>
            )}
          </div>
        </section>
        {selected && (
          <LogInspector
            key={selected.id}
            log={selected}
            onClose={close}
            onPrevious={index > 0 ? () => update({ logId: logs[index - 1].id }) : undefined}
            onNext={
              index >= 0 && index < logs.length - 1
                ? () => update({ logId: logs[index + 1].id })
                : undefined
            }
          />
        )}
      </div>
      {selectedId && historical.error && !selected && (
        <div className="inline-error" role="status">
          The linked event is no longer retained.
          <button className="text-button" onClick={close}>
            Dismiss
          </button>
        </div>
      )}
      <footer className="results-footer">
        <div>
          <span>
            Showing {count(logs.length)} logs{' '}
            {frozen ? '· older snapshot' : paused ? '· paused' : '· live'}
          </span>
          <small>
            <i className={'status-dot ' + (!paused && !frozen ? 'positive' : '')} />
            {frozen
              ? 'Results held while browsing older events'
              : 'Newest first · exact recorded events'}
          </small>
        </div>
        <div className="footer-actions">
          {frozen && (
            <button
              className="button"
              onClick={() => {
                setSnapshot(null);
                resource.refresh();
              }}
            >
              Refresh latest
            </button>
          )}
          <button
            className="button load-older"
            disabled={!cursor || loadingOlder}
            onClick={() => void older()}
          >
            {loadingOlder ? 'Loading…' : '↓ Load older logs'}
          </button>
          <select
            aria-label="Rows per page"
            value={limit}
            onChange={(event) => update({ limit: event.target.value, logId: null })}
          >
            {[25, 50, 100].map((n) => (
              <option value={n} key={n}>
                {n} rows
              </option>
            ))}
          </select>
        </div>
      </footer>
    </div>
  );
}
