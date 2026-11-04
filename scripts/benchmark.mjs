import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { root, json, waitFor, freePort, npm } from './runtime.mjs';
import { startStack } from './stack.mjs';
import { makeLog, generate } from './simulator.mjs';
await npm(['run', 'build'], root + '/api');
await mkdir(root + '/.runtime', { recursive: true });
const directory = await mkdtemp(root + '/.runtime/bench-');
const count = Number(process.argv.find((s) => s.startsWith('--count='))?.slice(8) ?? 100000),
  rate = Number(process.argv.find((s) => s.startsWith('--rate='))?.slice(7) ?? 20000),
  seconds = Number(process.argv.find((s) => s.startsWith('--seconds='))?.slice(10) ?? 15);
for (const n of [count, rate, seconds])
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error('Benchmark arguments must be positive integers.');
await writeFile(
  directory + '/events.ndjson',
  Array.from({ length: count }, (_, i) => JSON.stringify(makeLog(i, 'bulk'))).join('\n') + '\n',
);
const started = performance.now(),
  stack = await startStack({
    directory,
    apiPort: await freePort(),
    queuePort: await freePort(),
    quiet: true,
    capacity: 1000000,
  });
let report;
try {
  await waitFor(
    async () => (await json(stack.apiUrl + '/metrics')).indexedLogs === count,
    120000,
    'bulk index',
  );
  await waitFor(async () => (await json(stack.queueUrl + '/api/queue/stats')).pending === 0);
  const elapsed = (performance.now() - started) / 1000;
  console.log(
    'Bulk indexed ' + count + ' logs in ' + elapsed.toFixed(3) + 's, including service startup.',
  );
  const cases = [
    ['literal phrase', { q: 'connection timeout' }],
    ['common phrase', { q: 'request completed' }],
    ['source and level', { q: 'connection timeout', source: 'auth', level: 'error' }],
  ];
  const searches = [];
  for (const [label, filters] of cases) {
    const url = stack.apiUrl + '/api/logs/page?' + new URLSearchParams({ ...filters, limit: '50' });
    for (let i = 0; i < 5; i++) await json(url);
    const samples = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now(),
        page = await json(url);
      assert.ok(page.logs.length > 0);
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    searches.push({
      label,
      endpoint: '/api/logs/page',
      corpusLogs: count,
      p50Ms: samples[Math.floor(samples.length * 0.5)],
      p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
      samples: samples.length,
    });
  }
  const before = await json(stack.apiUrl + '/metrics'),
    abort = new AbortController(),
    timing = performance.now(),
    simulation = generate(stack.file, { rate, signal: abort.signal }),
    observations = [];
  while (performance.now() - timing < seconds * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const metrics = await json(stack.apiUrl + '/metrics');
    observations.push({
      elapsedSeconds: (performance.now() - timing) / 1000,
      indexedLogs: metrics.indexedLogs,
      pending: metrics.queue.pending,
    });
  }
  abort.abort();
  await simulation;
  const generationEnd = performance.now();
  const totals = await json(stack.queueUrl + '/api/queue/stats');
  // The file agent can still be draining its durable source file after generation stops.
  await waitFor(
    async () =>
      JSON.parse(
        await (
          await import('node:fs/promises')
        ).readFile(directory + '/agent.checkpoint.json', 'utf8'),
      ).offset === (await (await import('node:fs/promises')).stat(stack.file)).size,
    120000,
    'source checkpoint',
  );
  const delivered = await waitFor(
    async () => {
      const m = await json(stack.apiUrl + '/metrics');
      return m.queue.pending === 0 && m.queue.total === m.queue.acknowledged && m;
    },
    120000,
    'paced delivery',
  );
  const finished = performance.now(),
    pacedLogs = delivered.indexedLogs - before.indexedLogs;
  assert.equal(delivered.ingestion.rejected, 0);
  assert.equal(delivered.indexedLogs, delivered.queue.total);
  report = {
    recordedAt: new Date().toISOString(),
    environment: {
      os: os.platform(),
      arch: os.arch(),
      node: process.version,
      logicalCpus: os.cpus().length,
    },
    durability: {
      queue: 'WAL / synchronous FULL',
      index: 'WAL / synchronous FULL',
      acknowledgment: 'After durable index commit',
      pipeline: 'File → C++20 agent → C++20 queue → indexing worker → SQLite FTS5',
      uiAndDetectorIncluded: false,
    },
    bulk: { logs: count, secondsIncludingStartup: elapsed, logsPerSecond: count / elapsed },
    searches,
    paced: {
      offeredLogsPerSecond: rate,
      generationSeconds: (generationEnd - timing) / 1000,
      indexedLogs: pacedLogs,
      completionSeconds: (finished - timing) / 1000,
      achievedLogsPerSecond: pacedLogs / ((finished - timing) / 1000),
      observations,
      drained: true,
    },
    dataDirectory: directory,
  };
  await mkdir(root + '/benchmarks', { recursive: true });
  await writeFile(directory + '/benchmark.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile(root + '/benchmarks/latest.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await stack.processes.stop();
}
