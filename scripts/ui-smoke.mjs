import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { root, Processes, json, waitFor, freePort } from './runtime.mjs';
if (!process.env.npm_execpath) throw new Error('Run with npm run test:ui.');
await mkdir(root + '/.runtime', { recursive: true });
const directory = await mkdtemp(root + '/.runtime/ui-smoke-'),
  ports = [await freePort(), await freePort(), await freePort(), await freePort()],
  processes = new Processes(directory, true),
  checks = [];
let base = 'http://127.0.0.1:' + ports[3];
const pass = (name) => {
  checks.push(name);
  console.log('PASS ' + name);
};
const startDev = (owner, dataDirectory) =>
  owner.start('dev', process.execPath, [process.env.npm_execpath, 'run', 'dev'], {
    shutdownTimeout: 30000,
    env: {
      DATA_DIR: dataDirectory,
      API_PORT: String(ports[0]),
      QUEUE_PORT: String(ports[1]),
      ANOMALY_PORT: String(ports[2]),
      FRONTEND_PORT: String(ports[3]),
    },
  });
startDev(processes, directory);
try {
  await waitFor(
    async () => {
      processes.assertHealthy();
      return (await json(base + '/pipeline-metrics')).ingestion.isRunning;
    },
    300000,
    'npm run dev',
  );
  pass('One command starts every service');
  for (const [path, marker] of [
    ['/', 'Ingestion pipeline'],
    ['/overview', 'Component health'],
    ['/alerts', 'Search alerts'],
  ]) {
    const response = await fetch(base + path),
      html = await response.text();
    assert.equal(response.status, 200);
    assert.ok(html.includes(marker));
    assert.ok(!html.includes('Log Atlas'));
    pass('Page ' + path);
  }
  const first = await json(base + '/pipeline-metrics');
  const response = await fetch(base + '/api/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'smoke',
      level: 'error',
      message: 'smoke threshold evidence',
      raw: '{"latency_ms":205}',
    }),
  });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  const filters = new URLSearchParams({
      q: 'smoke threshold evidence',
      source: 'smoke',
      level: 'error',
    }),
    page = await json(base + '/api/logs/page?' + filters);
  assert.equal(page.logs.length, 1);
  assert.equal(page.logs[0].id, id);
  assert.equal(JSON.parse(page.logs[0].raw).latency_ms, 205);
  pass('Phrase/source/level filtering and raw-event fidelity');
  assert.equal((await json(base + '/api/logs/' + id)).id, id);
  pass('Historical event lookup');
  const require = createRequire(root + '/api/package.json'),
    Database = require('better-sqlite3'),
    db = new Database(directory + '/logs.db');
  db.pragma('busy_timeout=10000');
  db.prepare(
    'INSERT INTO alerts (id,log_id,severity,message,details,created_at,acknowledged) VALUES (?,?,?,?,?,?,0)',
  ).run(
    'smoke-alert',
    id,
    'high',
    'smoke test alert',
    JSON.stringify({ source: 'smoke', errorsPerMinute: 40, threshold: 10, windowMinutes: 5 }),
    new Date().toISOString(),
  );
  db.close();
  const af = new URLSearchParams({ q: 'smoke test alert', source: 'smoke', acknowledged: 'false' });
  assert.equal((await json(base + '/api/alerts?' + af)).total, 1);
  await json(base + '/api/alerts/smoke-alert/acknowledge', { method: 'POST' });
  assert.equal((await json(base + '/api/alerts?' + af)).total, 0);
  af.set('acknowledged', 'true');
  assert.equal((await json(base + '/api/alerts?' + af)).total, 1);
  pass('Scoped alert filtering and persistent acknowledgment');
  assert.ok((await json(base + '/api/alerts/stats')).openBySeverity);
  pass('Open severity counts');
  assert.equal((await json(base + '/detector-status')).status, 'running');
  pass('Python detector proxy');
  const after = await waitFor(
    async () => {
      const m = await json(base + '/pipeline-metrics');
      return m.indexedLogs > first.indexedLogs + 5000 && m;
    },
    30000,
    'live counters',
  );
  assert.ok(after.queue.reachable);
  pass('Live simulation counters advance');
  assert.ok((await json(base + '/api/logs/stats')).bySource.smoke);
  pass('Source statistics');
} finally {
  await processes.stop();
  await waitFor(
    async () =>
      (
        await Promise.all(
          ports.map(async (port) => {
            try {
              await fetch('http://127.0.0.1:' + port + '/health', {
                signal: AbortSignal.timeout(500),
              });
              return false;
            } catch {
              return true;
            }
          }),
        )
      ).every(Boolean),
    15000,
    'owned services shutdown',
  );
  pass('Owned services stopped');
  await writeFile(
    directory + '/results.json',
    JSON.stringify(
      {
        passed: false,
        checks,
        command: 'npm run dev',
        recordedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Runtime artifacts: ' + directory);
}

for (let i = 0; i < ports.length; i++) ports[i] = await freePort();
base = 'http://127.0.0.1:' + ports[3];
const failedDirectory = directory + '/write-failure',
  failureProcesses = new Processes(failedDirectory, true);
const failedDev = startDev(failureProcesses, failedDirectory);
failedDev.expectedExit = true;
try {
  await waitFor(
    async () => (await json(base + '/pipeline-metrics')).indexedLogs > 1000,
    120000,
    'second dev startup',
  );
  await chmod(failedDirectory + '/events.ndjson', 0o444);
  await waitFor(() => failedDev.exitCode !== null, 45000, 'generator failure shutdown');
  assert.equal(failedDev.exitCode, 1);
  assert.match(
    await readFile(failedDirectory + '/output/dev.log', 'utf8'),
    /EACCES|EPERM|permission denied/i,
  );
  for (const port of ports) {
    await waitFor(
      async () => {
        try {
          await fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(500) });
          return false;
        } catch {
          return true;
        }
      },
      15000,
      'failed dev service shutdown',
    );
  }
  pass('Generator write failure stops all owned services');
} finally {
  await chmod(failedDirectory + '/events.ndjson', 0o644).catch(() => {});
  await failureProcesses.stop();
}
await writeFile(
  directory + '/results.json',
  JSON.stringify(
    {
      passed: checks.length === 13,
      checks,
      command: 'npm run dev',
      recordedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
