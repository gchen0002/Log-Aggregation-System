import { openDatabase } from './db/database';
import { IngestionController } from './services/ingestionController';
import { createApp } from './app';
const dbPath = process.env.DB_PATH || './data/logs.db',
  queueUrl = process.env.QUEUE_URL || 'http://127.0.0.1:8081';
const db = openDatabase(dbPath);
// Initialize the schema before starting a second SQLite connection.
import { LogRepository } from './db/logRepository';
new LogRepository(db);
const ingestion = new IngestionController(dbPath, queueUrl);
const { app, monitor } = createApp(db, queueUrl, ingestion);
const server = app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => {
  monitor.start();
  console.log('Search API ready');
});
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  monitor.stop();
  const closed=new Promise<void>(resolve=>server.close(()=>resolve()));
  await Promise.all([closed,ingestion.stop()]);
  db.close();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
