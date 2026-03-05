import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { LogRepository } from './db/logRepository';
import { AlertRepository } from './db/alertRepository';
import { QueueService } from './services/queueService';
import { QueueConsumer } from './services/queueConsumer';
import { AlertService } from './services/alertService';
import { createLogsRouter } from './routes/logs';
import { createAlertsRouter } from './routes/alerts';

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data/logs.db';
const QUEUE_URL = process.env.QUEUE_URL || 'http://localhost:8081';
const QUEUE_POLL_INTERVAL = parseInt(process.env.QUEUE_POLL_INTERVAL_MS || '5000', 10) || 5000;

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database and repositories (single shared connection)
const db = new Database(DB_PATH);
const logRepo = new LogRepository(db);
const alertRepo = new AlertRepository(db);

// Initialize services
const queueService = new QueueService(QUEUE_URL);
const queueConsumer = new QueueConsumer(logRepo, queueService, QUEUE_POLL_INTERVAL);
const alertService = new AlertService(alertRepo, logRepo);

// Middleware
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Health check
app.get('/health', (_req: Request, res: Response) => {
  const consumerStatus = queueConsumer.getStatus();
  const alertStatus = alertService.getStatus();
  
  res.json({ 
    status: 'ok',
    services: {
      queueConsumer: consumerStatus.isRunning ? 'running' : 'stopped',
      alertService: alertStatus.isRunning ? 'running' : 'stopped'
    }
  });
});

// Mount routes
app.use('/api/logs', createLogsRouter(logRepo));
app.use('/api/alerts', createAlertsRouter(alertRepo, alertService));

// Error handling middleware (must have 4 parameters)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Queue URL: ${QUEUE_URL}`);
  
  // Start background services
  queueConsumer.start();
  alertService.start();
});

// Graceful shutdown
let shuttingDown = false;

function gracefulShutdown(signal: string): void {
  if (shuttingDown) {
    console.log(`Already shutting down, ignoring ${signal}`);
    return;
  }
  shuttingDown = true;

  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
  
  // Stop background services
  queueConsumer.stop();
  alertService.stop();
  
  // Close server first, then close database after in-flight requests finish
  server.close(() => {
    db.close();
    console.log('Server closed. Exiting.');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  gracefulShutdown('unhandledRejection');
});