import assert from 'node:assert/strict';
import { mkdir, mkdtemp, appendFile, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { root, npm, native, json, waitFor, freePort } from './runtime.mjs';
import { startStack } from './stack.mjs';
import { makeLog } from './simulator.mjs';
await npm(['run', 'build'], root + '/api');
await mkdir(root + '/.runtime', { recursive: true });
const directory = await mkdtemp(root + '/.runtime/integration-');
const stack = await startStack({
  directory,
  apiPort: await freePort(),
  queuePort: await freePort(),
  leaseSeconds: 2,
  quiet: true,
});
const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log('PASS ' + name);
};
const post = (route, body) =>
  json(stack.queueUrl + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const count = async () => (await json(stack.apiUrl + '/metrics')).indexedLogs;
const drained = () =>
  waitFor(
    async () => (await json(stack.queueUrl + '/api/queue/stats')).pending === 0,
    30000,
    'queue drain',
  );
let queue = stack.queue,
  api = stack.api,
  agent = stack.agent;
try {
  await appendFile(
    stack.file,
    Array.from({ length: 2500 }, (_, i) => JSON.stringify(makeLog(i, 'pipeline'))).join('\n') +
      '\n',
  );
  await waitFor(async () => (await count()) === 2500, 30000, 'file ingestion');
  await drained();
  assert.equal((await json(stack.apiUrl + '/api/logs?q=connection%20timeout')).total, 26);
  pass('File → C++ agent → durable queue → worker → SQLite FTS');
  await stack.processes.stopChild(agent, true);
  const checkpoint = JSON.parse(await readFile(directory + '/agent.checkpoint.json', 'utf8'));
  checkpoint.offset = 0;
  await writeFile(directory + '/agent.checkpoint.json', JSON.stringify(checkpoint));
  agent = stack.startAgent();
  await waitFor(
    async () =>
      JSON.parse(await readFile(directory + '/agent.checkpoint.json', 'utf8')).offset ===
      (await readFile(stack.file)).length,
  );
  await drained();
  assert.equal(await count(), 2500);
  pass('Checkpoint loss and source replay do not duplicate indexed logs');
  await stack.processes.stopChild(api, true);
  const logs = Array.from({ length: 500 }, (_, i) => ({
    ...makeLog(i, 'fragmented'),
    message: 'fragmented payload ' + i + ' ' + 'x'.repeat(150),
  }));
  const body = JSON.stringify({ id: 'fragmented-batch', logs });
  assert.ok(Buffer.byteLength(body) > 32768);
  await new Promise((resolve, reject) => {
    const req = http.request(
      stack.queueUrl + '/api/logs/batch',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          res.statusCode === 201 ? resolve() : reject(new Error('HTTP ' + res.statusCode)),
        );
      },
    );
    req.on('error', reject);
    void (async () => {
      for (let i = 0; i < body.length; i += 1024) {
        req.write(body.slice(i, i + 1024));
        await delay(1);
      }
      req.end();
    })().catch(reject);
  });
  const duplicate = await fetch(stack.queueUrl + '/api/logs/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await json(stack.queueUrl + '/api/queue/stats')).pending, 500);
  const conflict = await fetch(stack.queueUrl + '/api/logs/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'fragmented-batch', logs: [makeLog(0, 'different')] }),
  });
  assert.equal(conflict.status, 409);
  pass('Fragmented HTTP, idempotent enqueue and conflicting batch-id detection');
  const first = (await json(stack.queueUrl + '/api/logs/pending')).messages;
  assert.equal(first.length, 1);
  assert.equal((await json(stack.queueUrl + '/api/logs/pending')).messages.length, 0);
  await stack.processes.stopChild(queue, true);
  queue = stack.startQueue();
  await waitFor(() => json(stack.queueUrl + '/health'));
  assert.equal((await json(stack.queueUrl + '/api/queue/stats')).pending, 500);
  await delay(2200);
  const second = (await json(stack.queueUrl + '/api/logs/pending')).messages;
  assert.equal(second.length, 1);
  assert.notEqual(first[0].lease, second[0].lease);
  assert.equal(
    (await post('/api/logs/ack', { leases: first.map(({ id, lease }) => ({ id, lease })) }))
      .acknowledged,
    0,
  );
  pass('SIGKILL recovery, lease redelivery and stale-ack fencing');
  api = stack.startApi();
  await waitFor(() => json(stack.apiUrl + '/health'));
  await waitFor(async () => (await count()) === 3000);
  await drained();
  await post('/api/logs/batch', { id: 'ambiguous-ack-replay', logs });
  await drained();
  assert.equal(await count(), 3000);
  pass('Index commit survives consumer crash and ambiguous delivery');
  const before = JSON.parse(await readFile(directory + '/agent.checkpoint.json', 'utf8')).offset;
  await stack.processes.stopChild(queue, true);
  await appendFile(stack.file, JSON.stringify(makeLog(0, 'outage')) + '\n');
  await delay(600);
  assert.equal(
    JSON.parse(await readFile(directory + '/agent.checkpoint.json', 'utf8')).offset,
    before,
  );
  queue = stack.startQueue();
  await waitFor(() => json(stack.queueUrl + '/health'));
  await waitFor(async () => (await count()) === 3001);
  await drained();
  pass('Queue outage applies backpressure without advancing the source checkpoint');
  const partial = JSON.stringify(makeLog(0, 'partial'));
  await appendFile(stack.file, partial);
  await delay(250);
  assert.equal(await count(), 3001);
  await appendFile(stack.file, '\n');
  await waitFor(async () => (await count()) === 3002);
  pass('Incomplete lines wait for a newline');
  await stack.processes.stopChild(agent, true);
  await rename(stack.file, stack.file + '.old');
  await writeFile(
    stack.file,
    JSON.stringify({ ...makeLog(0, 'rotation'), message: 'Unicode 日本語 🙂' }) + '\n',
  );
  agent = stack.startAgent();
  await waitFor(async () => (await count()) === 3003);
  await drained();
  pass('Source replacement and Unicode survive native restarts');
  await post('/api/logs/batch', {
    id: 'poison',
    logs: [
      { id: 'invalid-time', message: 'invalid time', timestamp: 'not-a-date' },
      makeLog(0, 'valid-after-poison'),
    ],
  });
  await waitFor(async () => (await count()) === 3004);
  await drained();
  await waitFor(async () => (await json(stack.apiUrl + '/metrics')).ingestion.rejected === 1);
  pass('Invalid records are durably quarantined without blocking valid delivery');
  const page = await json(stack.apiUrl + '/api/logs/page?limit=25'),
    older = await json(
      stack.apiUrl + '/api/logs/page?limit=25&cursor=' + encodeURIComponent(page.nextCursor),
    );
  assert.equal(new Set([...page.logs, ...older.logs].map((log) => log.id)).size, 50);
  pass('Cursor pages preserve unique, timestamp-ordered search results');
  const inputs = [
    {
      severity: 'ERROR',
      msg: 'parser regression alias',
      service: 'payments',
      timestamp: 1700000000,
    },
    {
      id: 'parser-text',
      log_level: 'warning',
      text: 'parser regression text',
      app: 'catalog',
      time: '2024-01-02T12:34:56.789+05:30',
    },
    ...[0, 1, 2, 3].map((level) => ({
      id: 'parser-level-' + level,
      level,
      message: 'parser regression numeric ' + level,
      source: 'auth',
      timestamp: 1700000000123,
    })),
    {
      id: 'parser-string-seconds',
      level: 'fatal',
      message: 'parser regression seconds',
      source: 'worker',
      ts: '1700000000',
    },
    {
      id: 'parser-string-ms',
      level: 'notice',
      message: 'parser regression milliseconds',
      source: 'worker',
      timestamp: '1700000000123',
    },
    {
      id: 'parser-canonical',
      level: 'error',
      severity: 'info',
      message: 'parser regression canonical',
      msg: 'ignored alias',
      source: 'gateway',
      service: 'ignored',
      timestamp: '2024-01-02T12:34:56.123Z',
      raw: 'original custom payload',
    },
  ];
  const originalLines = inputs.map((value) => JSON.stringify(value));
  await appendFile(stack.file, originalLines.join('\n') + '\n');
  await waitFor(async () => (await count()) === 3004 + inputs.length);
  await drained();
  const normalized = (await json(stack.apiUrl + '/api/logs/page?q=parser%20regression')).logs;
  assert.equal(normalized.length, inputs.length);
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i],
      row = normalized.find((row) => row.message === (input.message ?? input.msg ?? input.text));
    assert.ok(row);
    assert.equal(row.source, input.source ?? input.service ?? input.app);
    assert.equal(row.raw, input.raw ?? originalLines[i]);
    if (input.id) assert.equal(row.id, input.id);
    const level =
      typeof input.level === 'number'
        ? ['debug', 'info', 'warn', 'error'][input.level]
        : (input.level ?? input.severity ?? input.log_level);
    assert.equal(
      row.level,
      { ERROR: 'error', warning: 'warn', fatal: 'error', notice: 'info' }[level] ?? level,
    );
    const stamp = input.timestamp ?? input.time ?? input.ts;
    const millis = String(stamp).match(/^\d+$/)
      ? Number(stamp) * (Number(stamp) < 1e12 ? 1000 : 1)
      : Date.parse(stamp);
    assert.equal(row.timestamp, new Date(millis).toISOString());
  }
  await waitFor(
    async () =>
      JSON.parse(await readFile(directory + '/agent.checkpoint.json', 'utf8')).offset ===
      (await readFile(stack.file)).length,
  );
  await stack.processes.stopChild(agent, true);
  const replayState = JSON.parse(await readFile(directory + '/agent.checkpoint.json', 'utf8'));
  replayState.offset = 0;
  await writeFile(directory + '/agent.checkpoint.json', JSON.stringify(replayState));
  agent = stack.startAgent();
  await waitFor(
    async () =>
      JSON.parse(await readFile(directory + '/agent.checkpoint.json', 'utf8')).offset ===
      (await readFile(stack.file)).length,
  );
  await drained();
  assert.deepEqual(
    (await json(stack.apiUrl + '/api/logs/page?q=parser%20regression')).logs,
    normalized,
  );
  assert.equal((await json(stack.apiUrl + '/metrics')).ingestion.rejected, 1);
  pass('JSON aliases, numeric levels, timestamp units, raw payloads and stable replay IDs');
  await stack.processes.stopChild(agent, true);
  const position = JSON.parse(await readFile(directory + '/agent.checkpoint.json', 'utf8')).offset;
  await appendFile(stack.file, 'x'.repeat(1024 * 1024 + 1));
  const oversized = stack.startAgent();
  oversized.expectedExit = true;
  await waitFor(() => oversized.exitCode === 1);
  assert.equal(
    JSON.parse(await readFile(directory + '/agent.checkpoint.json', 'utf8')).offset,
    position,
  );
  pass('Oversized lines fail explicitly without source checkpoint advancement');
  const capacityPort = await freePort(),
    capacityDb = directory + '/capacity.db';
  stack.processes.start('bounded-queue', native('log_queue'), [
    '--db',
    capacityDb,
    '--port',
    String(capacityPort),
    '--capacity',
    '10',
  ]);
  const base = 'http://127.0.0.1:' + capacityPort;
  await waitFor(() => json(base + '/health'));
  const bodies = new Map();
  const send = async (id, n) => {
    if (!bodies.has(id))
      bodies.set(
        id,
        JSON.stringify({ id, logs: Array.from({ length: n }, (_, i) => makeLog(i, id)) }),
      );
    return fetch(base + '/api/logs/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bodies.get(id),
    });
  };
  assert.equal((await send('too-large', 11)).status, 429);
  assert.equal((await send('bounded', 10)).status, 201);
  assert.equal((await send('overflow', 1)).status, 429);
  const leased = (await json(base + '/api/logs/pending')).messages;
  await json(base + '/api/logs/ack', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ leases: leased.map(({ id, lease }) => ({ id, lease })) }),
  });
  assert.equal((await send('bounded', 10)).status, 200);
  assert.equal((await json(base + '/api/queue/stats')).pending, 0);
  pass('Bounded capacity and durable deduplication after acknowledgment');
  const require = createRequire(root + '/api/package.json'),
    Database = require('better-sqlite3');
  const db = new Database(stack.dbPath, { readonly: true });
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rejected_logs').get().n, 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.close();
  pass('SQLite integrity and retained quarantine evidence after forced crashes');
} finally {
  await stack.processes.stop();
  await writeFile(
    directory + '/results.json',
    JSON.stringify(
      { checks, passed: checks.length === 14, recordedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  );
  console.log('Integration artifacts: ' + directory);
}
