import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const windows = process.platform === 'win32';
export const python = path.join(
  root,
  'anomaly/.venv',
  windows ? 'Scripts/python.exe' : 'bin/python',
);
export const cmake = existsSync(path.join(path.dirname(python), windows ? 'cmake.exe' : 'cmake'))
  ? path.join(path.dirname(python), windows ? 'cmake.exe' : 'cmake')
  : 'cmake';
export const native = (name) => path.join(root, 'build/bin', name + (windows ? '.exe' : ''));
const npmCli =
  process.env.npm_execpath ||
  [
    path.resolve(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ].find(existsSync);
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(command + ' exited ' + code)),
    );
  });
}
export const npm = (args, cwd = root) => {
  if (!npmCli) throw new Error('Run through npm.');
  return run(process.execPath, [npmCli, ...args], { cwd });
};
export async function json(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), ...options });
  if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + (await response.text()));
  return response.json();
}
export async function waitFor(check, timeout = 30000, label = 'service') {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await delay(100);
  }
  throw new Error('Timeout waiting for ' + label + ': ' + (last?.message ?? ''));
}
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}
export async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', () =>
      reject(new Error('Port ' + port + ' is busy; stop its owner or choose another port.')),
    );
    s.listen(port, '127.0.0.1', () => s.close(resolve));
  });
}
export class Processes {
  children = [];
  stopping = false;
  failure = null;
  constructor(directory, quiet = false) {
    this.directory = directory;
    this.quiet = quiet;
    mkdirSync(path.join(directory, 'output'), { recursive: true });
  }
  start(name, command, args, options = {}) {
    const { shutdownTimeout = 15000, ...spawnOptions } = options;
    const child = spawn(command, args, {
      cwd: root,
      detached: !windows,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...spawnOptions,
      env: {
        ...process.env,
        OPENBLAS_NUM_THREADS: '2',
        OMP_NUM_THREADS: '2',
        NEXT_TELEMETRY_DISABLED: '1',
        ...options.env,
      },
    });
    child.shutdownTimeout = shutdownTimeout;
    const output = createWriteStream(path.join(this.directory, 'output', name + '.log'), {
      flags: 'a',
    });
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    if (!this.quiet) {
      child.stdout.on('data', (data) => process.stdout.write('[' + name + '] ' + data));
      child.stderr.on('data', (data) => process.stderr.write('[' + name + '] ' + data));
    }
    child.on('error', (error) => {
      child.failure = error;
      this.failure = error;
    });
    child.on('exit', (code, signal) => {
      output.end();
      if (!this.stopping && !child.expectedExit)
        this.failure = new Error(
          name +
            ' exited ' +
            (code ?? signal) +
            '; see ' +
            this.directory +
            '/output/' +
            name +
            '.log',
        );
    });
    this.children.push(child);
    return child;
  }
  assertHealthy() {
    if (this.failure) throw this.failure;
  }
  async stopChild(child, force = false) {
    child.expectedExit = true;
    if (child.exitCode !== null || child.signalCode !== null || child.failure) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const kill = (strong) => {
      try {
        if (windows)
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', ...(strong ? ['/F'] : [])], {
            stdio: 'ignore',
          });
        else process.kill(-child.pid, strong ? 'SIGKILL' : 'SIGTERM');
      } catch {}
    };
    kill(force);
    const timer = setTimeout(() => kill(true), child.shutdownTimeout);
    await exited;
    clearTimeout(timer);
  }
  async stop() {
    this.stopping = true;
    await Promise.all([...this.children].reverse().map((child) => this.stopChild(child)));
  }
}
