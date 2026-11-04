import assert from 'node:assert/strict';
import { json, waitFor } from './runtime.mjs';
const base = process.env.DASHBOARD_URL || 'http://127.0.0.1:3001';
for (const route of ['/', '/overview', '/alerts']) {
  const response = await fetch(base + route);
  assert.equal(response.status, 200);
  console.log('PASS production page ' + route);
}
const before = await waitFor(
  async () => {
    const m = await json(base + '/pipeline-metrics');
    return m.indexedLogs > 1000 && m;
  },
  60000,
  'container file ingestion',
);
assert.ok(before.queue.reachable);
assert.ok(before.ingestion.isRunning);
assert.equal(before.ingestion.rejected, 0);
assert.ok(before.queue.acknowledged > 0);
const result = await json(base + '/api/logs/page?q=connection%20timeout&source=auth&level=error');
assert.ok(result.logs.length > 0);
assert.ok(
  result.logs.every(
    (row) =>
      row.source === 'auth' && row.level === 'error' && row.message.includes('connection timeout'),
  ),
);
assert.equal((await json(base + '/detector-status')).status, 'running');
await waitFor(
  async () => (await json(base + '/pipeline-metrics')).indexedLogs > before.indexedLogs + 1000,
  30000,
  'container live counters',
);
console.log(
  'PASS non-root containers: simulator → file agent → durable queue → FTS, filters, proxies, detector and live counters',
);
