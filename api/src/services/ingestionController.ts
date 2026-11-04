import { Worker } from 'node:worker_threads';
import path from 'node:path';
export class IngestionController {
  state: { isRunning: boolean; lastError: string | null; duplicates: number; rejected: number } = {
    isRunning: false,
    lastError: null,
    duplicates: 0,
    rejected: 0,
  };
  private worker: Worker;
  private exited = false;
  constructor(dbPath: string, queueUrl: string) {
    this.worker = new Worker(path.join(__dirname, 'ingestionWorker.js'), {
      workerData: { dbPath, queueUrl },
    });
    this.worker.on('message', (state) => {
      this.state = state;
    });
    this.worker.on('error', (error) => {
      this.state = { ...this.state, isRunning: false, lastError: error.message };
    });
    this.worker.on('exit', () => {
      this.exited = true;
      this.state = { ...this.state, isRunning: false };
    });
  }
  async stop() {
    if (this.exited) return;
    this.worker.postMessage('stop');
    const timer = setTimeout(() => void this.worker.terminate(), 12000);
    await new Promise<void>((resolve) => {
      this.worker.once('exit', () => resolve());
      if (!this.state.isRunning) void this.worker.terminate();
    });
    clearTimeout(timer);
  }
}
