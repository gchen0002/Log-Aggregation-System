import { appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
export function makeLog(i, run = 'simulation') {
  const sources = ['gateway', 'auth', 'payments', 'catalog', 'worker'],
    level = i % 97 === 0 ? 'error' : i % 29 === 0 ? 'warn' : 'info',
    latency = (i * 37) % 250;
  return {
    id: run + ':' + i,
    timestamp: new Date().toISOString(),
    source: sources[i % 5],
    level,
    message:
      (level === 'error'
        ? 'connection timeout'
        : level === 'warn'
          ? 'upstream slow response'
          : 'request completed') +
      ' operation' +
      i +
      ' latency=' +
      latency +
      'ms request=' +
      i,
    latency_ms: latency,
    request_id: 'req-' + i,
  };
}
export async function generate(file, { rate = 5000, signal } = {}) {
  let n = 0;
  const run = randomUUID(),
    start = performance.now();
  while (!signal?.aborted) {
    const target = Math.floor(((performance.now() - start) * rate) / 1000),
      size = Math.min(Math.max(0, target - n), 10000);
    if (size) {
      await appendFile(
        file,
        Array.from({ length: size }, () => JSON.stringify(makeLog(n++, run))).join('\n') + '\n',
      );
    } else await delay(15);
  }
}
