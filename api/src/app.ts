import express from 'express';
import { performance } from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import { LogRepository } from './db/logRepository';
import { AlertRepository } from './db/alertRepository';
import { AlertService } from './services/alertService';
import { createLogsRouter } from './routes/logs';
import { createAlertsRouter } from './routes/alerts';
import type { IngestionController } from './services/ingestionController';
export function createApp(db: Database.Database, queueUrl: string, ingestion: IngestionController) {
  const app = express(),
    logs = new LogRepository(db),
    alerts = new AlertRepository(db),
    monitor = new AlertService(alerts, logs),
    samples: number[] = [];
  const start = performance.now();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));
  app.get('/health', (_req, res) =>
    res
      .status(ingestion.state.isRunning ? 200 : 503)
      .json({ status: ingestion.state.isRunning ? 'ok' : 'degraded', ingestion: ingestion.state }),
  );
  app.get('/metrics', async (_req, res) => {
    let queue: Record<string, unknown> = { reachable: false };
    try {
      const response = await fetch(queueUrl + '/api/queue/stats', {
        signal: AbortSignal.timeout(1200),
      });
      if (response.ok) queue = { ...((await response.json()) as object), reachable: true };
    } catch {}
    const sorted = [...samples].sort((a, b) => a - b);
    const percentile = (p: number) =>
      sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
    res.json({
      indexedLogs: logs.count(),
      uptimeSeconds: (performance.now() - start) / 1000,
      ingestion: ingestion.state,
      queue,
      search: { samples: samples.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95) },
    });
  });
  app.use(
    '/api/logs',
    (req, res, next) => {
      const begin = performance.now();
      res.on('finish', () => {
        if (
          req.method === 'GET' &&
          (req.path === '/' || req.path === '/page') &&
          res.statusCode === 200
        ) {
          samples.push(performance.now() - begin);
          if (samples.length > 256) samples.shift();
        }
      });
      next();
    },
    createLogsRouter(logs),
  );
  app.use('/api/alerts', createAlertsRouter(alerts, monitor));
  app.use(
    (
      error: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(error.status === 400 ? 400 : error.status === 413 ? 413 : 500)
        .json({ error: 'Request could not be processed' });
    },
  );
  return { app, monitor, logs, alerts };
}
