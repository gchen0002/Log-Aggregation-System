import http from 'http';
import { QueueMessage, QueueStats } from '../types/log';

export class QueueService {
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;
  private maxResponseSize: number;

  constructor(
    baseUrl: string,
    timeout: number = 5000,
    maxRetries: number = 3,
    maxResponseSize: number = 10 * 1024 * 1024 // 10MB default
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = timeout;
    this.maxRetries = maxRetries;
    this.maxResponseSize = maxResponseSize;
  }

  async fetchBatch(): Promise<QueueMessage[]> {
    const url = `${this.baseUrl}/api/logs/pending`;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.httpGet(url);
        const data = JSON.parse(response) as { messages?: Array<{ id: number; content: string }> };
        
        if (!data.messages || !Array.isArray(data.messages)) {
          return [];
        }

        return data.messages.map(msg => ({
          id: msg.id,
          content: msg.content
        }));
      } catch (error) {
        if (attempt === this.maxRetries) {
          throw error;
        }
        // Exponential backoff with jitter to avoid thundering herd
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * 1000;
        await this.delay(baseDelay + jitter);
      }
    }
    
    throw new Error('Max retries exceeded');
  }

  async getStats(): Promise<QueueStats> {
    const url = `${this.baseUrl}/api/queue/stats`;
    
    try {
      const response = await this.httpGet(url);
      const data = JSON.parse(response) as { pending?: number; total?: number };
      
      return {
        pending: data.pending || 0,
        total: data.total || 0
      };
    } catch (error) {
      return { pending: 0, total: 0 };
    }
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const safeResolve = (value: string): void => {
        if (!settled) { settled = true; resolve(value); }
      };
      const safeReject = (error: Error): void => {
        if (!settled) { settled = true; reject(error); }
      };

      const request = http.get(url, { timeout: this.timeout }, (response) => {
        let data = '';
        let receivedSize = 0;
        
        response.on('data', (chunk: Buffer) => {
          receivedSize += chunk.length;
          if (receivedSize > this.maxResponseSize) {
            request.destroy();
            safeReject(new Error(`Response exceeded maximum size of ${this.maxResponseSize} bytes`));
            return;
          }
          data += chunk;
        });
        
        response.on('error', (error) => {
          safeReject(error);
        });
        
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            safeResolve(data);
          } else {
            safeReject(new Error(`HTTP ${response.statusCode}: ${data}`));
          }
        });
      });
      
      request.on('error', (error) => {
        safeReject(error);
      });
      
      request.on('timeout', () => {
        request.destroy();
        safeReject(new Error('Request timeout'));
      });
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}