'use client';
import Link from 'next/link';
import { useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import type { AlertItem, LogPage } from '../lib/model';
import { clock, count, eventFields, rawEvent, relatedParams } from '../lib/events';
import Icon from './Icon';
import JsonView from './JsonView';
export default function AlertRelatedLogs({ alert }: { alert: AlertItem }) {
  const params = relatedParams(alert);
  params.set('limit', '25');
  const resource = usePolling<LogPage>('/api/logs/page?' + params, 0, true),
    [selectedId, setSelectedId] = useState<string | null>(null),
    logs = resource.data?.logs ?? [],
    selected = logs.find((log) => log.id === selectedId) ?? logs[0],
    fields = selected ? eventFields(selected) : {},
    latency = fields.latency_ms ?? fields.latency,
    link = relatedParams(alert);
  if (selected) link.set('logId', selected.id);
  return (
    <section
      className="panel related-events"
      aria-label="Related alert logs"
      aria-busy={resource.loading}
    >
      <header className="panel-header">
        <h2>Related logs</h2>
        <span className="muted">
          {resource.data ? count(logs.length) + ' shown · ' : ''}Newest first
        </span>
      </header>
      <div
        className="table-scroll related-log-scroll"
        tabIndex={0}
        role="region"
        aria-label="Related logs table"
      >
        <table className="related-log-table">
          <thead>
            <tr>
              <th scope="col">Time ↓</th>
              <th scope="col">Source</th>
              <th scope="col">Level</th>
              <th scope="col">Message</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr
                key={log.id}
                className={selected?.id === log.id ? 'selected' : ''}
                onClick={() => setSelectedId(log.id)}
              >
                <td>
                  <button
                    className="related-log-select"
                    aria-pressed={selected?.id === log.id}
                    aria-label={
                      'Inspect ' +
                      log.level +
                      ' event from ' +
                      log.source +
                      ' at ' +
                      clock(log.timestamp, true)
                    }
                    onClick={() => setSelectedId(log.id)}
                  >
                    <time dateTime={log.timestamp}>{clock(log.timestamp, true)}</time>
                  </button>
                </td>
                <td title={log.source}>{log.source}</td>
                <td>
                  <span className={'level ' + log.level}>{log.level.toUpperCase()}</span>
                </td>
                <td title={log.message}>{log.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!resource.data && resource.loading && (
          <p className="quiet-state" role="status">
            Loading related events…
          </p>
        )}
        {resource.data && !logs.length && (
          <p className="quiet-state">No retained events match this detection window.</p>
        )}
        {resource.error && (
          <div className="related-error" role="alert">
            <p>Related events are unavailable.</p>
            <button className="text-button" onClick={resource.refresh}>
              Retry related events
            </button>
          </div>
        )}
      </div>
      {selected && (
        <section className="related-log-inspector" aria-label="Selected related log">
          <div className="related-inspector-heading">
            <h3>Selected log</h3>
            <Link className="text-button" href={'/?' + link}>
              Open in Explore <Icon name="chevron" size={13} />
            </Link>
          </div>
          <dl className="related-log-fields">
            <dt>Time</dt>
            <dd>{clock(selected.timestamp, true)}</dd>
            <dt>Source</dt>
            <dd>{selected.source}</dd>
            <dt>Level</dt>
            <dd>
              <span className={'level ' + selected.level}>{selected.level.toUpperCase()}</span>
            </dd>
            <dt>Message</dt>
            <dd>{selected.message}</dd>
            {latency != null && (
              <>
                <dt>Latency</dt>
                <dd>{typeof latency === 'number' ? latency + ' ms' : String(latency)}</dd>
              </>
            )}
          </dl>
          <details className="related-raw" key={selected.id}>
            <summary>Raw event</summary>
            <JsonView value={rawEvent(selected)} />
          </details>
        </section>
      )}
    </section>
  );
}
