'use client';
import Link from 'next/link';
import type { AlertItem } from '../lib/model';
import {
  alertSource,
  alertTitle,
  clock,
  count,
  numeric,
  relatedParams,
  serverDate,
} from '../lib/events';
import Icon from './Icon';
import JsonView from './JsonView';
export default function AlertDetail({
  alert,
  saving,
  acknowledged,
  onAcknowledge,
}: {
  alert: AlertItem;
  saving: boolean;
  acknowledged: boolean;
  onAcknowledge: () => void;
}) {
  const d = alert.details ?? {},
    current = numeric(d, 'errorsPerMinute', 'errors_per_minute'),
    threshold = numeric(d, 'threshold'),
    window = numeric(d, 'windowMinutes', 'window_minutes'),
    errors = numeric(d, 'errorCount', 'error_count'),
    score = numeric(d, 'anomaly_score'),
    title = alertTitle(alert),
    link = relatedParams(alert);
  if (alert.logId && alert.logId !== 'system') link.set('logId', alert.logId);
  const reason =
    current != null && threshold != null
      ? 'The observed error rate exceeded ' +
        threshold +
        ' errors per minute' +
        (window != null ? ' over a ' + window + '-minute window.' : '.')
      : alert.message;
  const facts: [string, string, string?][] = [];
  if (threshold != null)
    facts.push(['Threshold', String(threshold), current != null ? 'errors/minute' : undefined]);
  if (window != null) facts.push(['Detection window', window + ' min']);
  if (errors != null)
    facts.push([
      'Error events',
      count(errors),
      window != null ? 'in ' + window + ' minutes' : undefined,
    ]);
  if (numeric(d, 'current_count') != null)
    facts.push(['Current count', count(numeric(d, 'current_count'))]);
  if (numeric(d, 'mean_count') != null)
    facts.push(['Historical mean', count(numeric(d, 'mean_count'))]);
  if (numeric(d, 'z_score') != null) facts.push(['Z-score', numeric(d, 'z_score')!.toFixed(2)]);
  return (
    <aside className="panel alert-detail" id="alert-evidence" aria-label="Selected alert details">
      <header className="panel-header">
        <h2>Alert details</h2>
      </header>
      <div className="alert-detail-body">
        <div className="alert-detail-header">
          <div className="alert-detail-status">
            <span className={'severity ' + alert.severity}>{alert.severity}</span>
            {acknowledged && (
              <span className="acknowledged">
                <Icon name="check" size={14} />
                Acknowledged
              </span>
            )}
          </div>
          <h2>{title}</h2>
          {reason !== title && <p className="alert-reason">{reason}</p>}
          <div className="alert-meta">
            <span>
              <Icon name="box" size={15} />
              {alertSource(alert) ?? 'Across sources'}
            </span>
            <span>
              Detected{' '}
              <time dateTime={alert.createdAt} title={serverDate(alert.createdAt).toLocaleString()}>
                {clock(alert.createdAt)}
              </time>
            </span>
          </div>
        </div>
        {(current != null || score != null) && (
          <div className="observed-metric">
            <span>{current != null ? 'Observed error rate' : 'Anomaly score'}</span>
            <strong className={current != null ? 'comparison-exceeded' : ''}>
              {current != null
                ? current.toLocaleString('en-US', { maximumFractionDigits: 1 })
                : score?.toFixed(3)}
            </strong>
            {current != null && <span>errors/minute</span>}
          </div>
        )}
        {facts.length > 0 && (
          <dl className="evidence-grid">
            {facts.map(([label, value, unit]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
                {unit && <span>{unit}</span>}
              </div>
            ))}
          </dl>
        )}
        {current != null && threshold != null && current >= 0 && threshold >= 0 && (
          <figure
            className="threshold-chart"
            aria-label="Observed error rate compared with its threshold"
          >
            <figcaption>
              <h3>Error rate comparison</h3>
              <span className={current > threshold ? 'comparison-exceeded' : 'muted'}>
                {threshold > 0
                  ? (current / threshold).toLocaleString('en-US', { maximumFractionDigits: 2 }) +
                    '× threshold'
                  : current > 0
                    ? 'Threshold exceeded'
                    : 'At threshold'}
              </span>
            </figcaption>
            {[
              ['Observed', current],
              ['Threshold', threshold],
            ].map(([label, n]) => (
              <div
                key={label}
                className={'comparison-row ' + (label === 'Threshold' ? 'threshold-row' : '')}
              >
                <span>{label}</span>
                <div className="comparison-track">
                  <i style={{ width: (Number(n) / Math.max(1, current, threshold)) * 100 + '%' }} />
                </div>
                <strong>{Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })}</strong>
              </div>
            ))}
            <p>
              Errors per minute ·{' '}
              {window != null ? window + '-minute detection window' : 'At detection'}
            </p>
          </figure>
        )}
        {numeric(d, 'total_count') != null && (
          <p className="evidence-context">{count(numeric(d, 'total_count'))} analyzed events</p>
        )}
        <div className="alert-actions">
          <button
            className="button primary"
            disabled={saving || acknowledged}
            onClick={onAcknowledge}
          >
            <Icon name="check" size={16} />
            {acknowledged ? 'Acknowledged' : saving ? 'Acknowledging…' : 'Acknowledge'}
          </button>
          <Link className="button" href={'/?' + link}>
            <Icon name="file" size={16} />
            View related logs
          </Link>
        </div>
        <details className="detection-details">
          <summary>Detection details</summary>
          <p className="original-detection">{alert.message}</p>
          <JsonView value={d} />
        </details>
      </div>
    </aside>
  );
}
