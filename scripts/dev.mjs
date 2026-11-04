import path from 'node:path';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { root, python, npm } from './runtime.mjs';
import { buildNative } from './build-native.mjs';
import { startStack } from './stack.mjs';
import { generate } from './simulator.mjs';
const rate = Number(
  process.argv.find((v) => v.startsWith('--rate='))?.slice(7) ?? process.env.SIM_RATE ?? 5000,
);
if (!Number.isFinite(rate) || rate <= 0) throw new Error('Simulation rate must be positive.');
if (!existsSync(python) || !existsSync(root + '/api/node_modules'))
  throw new Error('Run npm run setup once.');
await buildNative();
await npm(['run', 'build'], root + '/api');
const abort = new AbortController();
let stack,
  stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  abort.abort();
  if (stack) await stack.processes.stop();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
try {
  stack = await startStack({
    directory: path.resolve(process.env.DATA_DIR || root + '/.runtime/demo'),
    apiPort: Number(process.env.API_PORT || 3000),
    queuePort: Number(process.env.QUEUE_PORT || 8081),
    anomalyPort: Number(process.env.ANOMALY_PORT || 5000),
    frontendPort: Number(process.env.FRONTEND_PORT || 3001),
    ui: true,
    anomaly: true,
  });
  if (stopping) {
    await stack.processes.stop();
  } else {
    console.log(
      'All services ready. Dashboard: http://localhost:' +
        (process.env.FRONTEND_PORT || 3001) +
        '; simulation ' +
        rate +
        ' logs/sec. Ctrl+C stops this stack.',
    );
    const simulation = generate(stack.file, { rate, signal: abort.signal });
    while (!stopping) {
      stack.processes.assertHealthy();
      await delay(250);
    }
    await simulation;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stop();
}
