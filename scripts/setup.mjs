import { existsSync } from 'node:fs';
import { run, npm, root, python, windows } from './runtime.mjs';
if (Number(process.versions.node.split('.')[0]) < 22)
  throw new Error('Node 22 or newer is required.');
if (!existsSync(python))
  await run(windows ? 'python' : 'python3', ['-m', 'venv', root + '/anomaly/.venv']);
await run(python, [
  '-m',
  'pip',
  'install',
  '-r',
  root + '/anomaly/requirements.txt',
  'cmake>=3.18,<4',
]);
await npm(['ci'], root + '/api');
await npm(['ci'], root + '/frontend');
console.log('Setup complete. Start the simulation with npm run dev.');
