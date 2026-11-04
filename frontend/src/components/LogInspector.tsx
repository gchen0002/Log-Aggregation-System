'use client';
import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../lib/model';
import { clock, eventFields, rawEvent, serverDate } from '../lib/events';
import Icon from './Icon';
import JsonView from './JsonView';
export default function LogInspector({
  log,
  onClose,
  onPrevious,
  onNext,
}: {
  log: LogEntry;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const [tab, setTab] = useState('raw'),
    [status, setStatus] = useState(''),
    close = useRef<HTMLButtonElement>(null),
    fields = eventFields(log),
    raw = rawEvent(log);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', escape);
    if (matchMedia('(max-width: 1000px)').matches)
      requestAnimationFrame(() =>
        document
          .getElementById('log-inspector')
          ?.scrollIntoView({
            block: 'start',
            behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          }),
      );
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);
  return (
    <aside className="panel inspector" id="log-inspector" aria-label="Selected event details">
      <header className="panel-header">
        <h2>Event details</h2>
        <div className="icon-actions">
          <button
            className="icon-button previous"
            aria-label="Previous event"
            disabled={!onPrevious}
            onClick={onPrevious}
          >
            <Icon name="chevron" size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Next event"
            disabled={!onNext}
            onClick={onNext}
          >
            <Icon name="chevron" size={15} />
          </button>
          <button
            className="icon-button"
            ref={close}
            aria-label="Close event details"
            onClick={onClose}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      </header>
      <div className="event-summary">
        <div className="event-stamp">
          <span className={'level ' + log.level}>{log.level.toUpperCase()}</span>
          <time dateTime={log.timestamp} title={serverDate(log.timestamp).toLocaleString()}>
            {clock(log.timestamp, true)}
          </time>
        </div>
        <dl className="field-list">
          <dt>Source</dt>
          <dd>{log.source}</dd>
          <dt>Message</dt>
          <dd className="event-message">{log.message}</dd>
          {[
            ['Latency', fields.latency_ms ?? fields.latency],
            ['Request ID', fields.request_id ?? fields.requestId ?? fields.request],
            ['Trace ID', fields.trace_id ?? fields.traceId],
            ['Host', fields.host],
          ]
            .filter(([, value]) => value != null)
            .map(([label, value]) => (
              <div className="field-pair" key={String(label)}>
                <dt>{String(label)}</dt>
                <dd>
                  {String(value)}
                  {label === 'Latency' && typeof value === 'number' ? ' ms' : ''}
                </dd>
              </div>
            ))}
        </dl>
      </div>
      <div className="inspector-tabs" role="tablist" aria-label="Event format">
        <button role="tab" aria-selected={tab === 'raw'} onClick={() => setTab('raw')}>
          Raw JSON
        </button>
        <button role="tab" aria-selected={tab === 'fields'} onClick={() => setTab('fields')}>
          Parsed fields
        </button>
        <button
          className="icon-button copy-button"
          aria-label="Copy event"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(raw);
              setStatus('Copied');
            } catch {
              setStatus('Select the event text to copy.');
            }
          }}
        >
          <Icon name="copy" size={15} />
        </button>
      </div>
      <div className="inspector-content" role="tabpanel">
        {tab === 'raw' ? (
          <JsonView value={raw} />
        ) : (
          <dl className="parsed-fields">
            {Object.entries(fields).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {status && (
        <p className="copy-status" role="status">
          {status}
        </p>
      )}
    </aside>
  );
}
