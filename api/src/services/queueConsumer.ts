import { v4 as uuidv4 } from 'uuid';
import { LogRepository } from '../db/logRepository';
import { QueueService } from './queueService';
import { LogEntry } from '../types/log';
import { normalizeLevel } from '../utils/logNormalizer';

interface RawLog {
  timestamp?: string | number;
  level?: string;
  message?: string;
  source?: string;
  [key: string]: unknown;
}

export class QueueConsumer {
  private logRepo: LogRepository;
  private queueService: QueueService;
  private pollInterval: number;
  private isRunning: boolean = false;
  private timeoutId: NodeJS.Timeout | null = null;
  private consecutiveErrors: number = 0;
  private maxConsecutiveErrors: number = 5;
  private pollLock: boolean = false;
  private failedMessageIds: Map<number, number> = new Map(); // id -> timestamp
  private readonly MAX_FAILED_IDS = 10000;

  constructor(
    logRepo: LogRepository,
    queueService: QueueService,
    pollInterval: number = 5000
  ) {
    this.logRepo = logRepo;
    this.queueService = queueService;
    this.pollInterval = pollInterval;
  }

  start(): void {
    if (this.isRunning) {
      console.log('[QueueConsumer] Already running');
      return;
    }

    this.isRunning = true;
    this.consecutiveErrors = 0;
    console.log('[QueueConsumer] Starting polling...');
    this.poll();
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    console.log('[QueueConsumer] Stopped');
  }

  private async poll(): Promise<void> {
    if (!this.isRunning || this.pollLock) {
      return;
    }

    this.pollLock = true;

    try {
      const messages = await this.queueService.fetchBatch();

      if (messages.length > 0) {
        console.log(`[QueueConsumer] Fetched ${messages.length} messages from queue`);
        const entries = this.parseMessages(messages);
        
        if (entries.length > 0) {
          try {
            const inserted = this.logRepo.insertBatch(entries);
            console.log(`[QueueConsumer] Inserted ${inserted} logs into database`);
          } catch (insertError) {
            console.error('[QueueConsumer] Error inserting batch:', insertError);
            throw insertError; // Re-throw to trigger retry logic
          }
        }
        
        this.consecutiveErrors = 0;
      }
    } catch (error) {
      this.consecutiveErrors++;
      console.error(`[QueueConsumer] Error processing batch (attempt ${this.consecutiveErrors}):`, error);
      
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        console.error('[QueueConsumer] Too many consecutive errors, stopping consumer');
        this.pollLock = false;
        this.stop();
        return;
      }
    } finally {
      this.pollLock = false;
    }

    if (this.isRunning) {
      const backoffDelay = this.calculateBackoff();
      this.timeoutId = setTimeout(() => this.poll(), backoffDelay);
    }
  }

  private calculateBackoff(): number {
    const baseDelay = this.pollInterval;
    const backoffMultiplier = Math.min(Math.pow(2, this.consecutiveErrors), 8);
    return baseDelay * backoffMultiplier;
  }

  private parseMessages(messages: Array<{ id: number; content: string }>): LogEntry[] {
    const entries: LogEntry[] = [];

    for (const message of messages) {
      // Skip messages that have previously failed to parse
      if (this.failedMessageIds.has(message.id)) {
        continue;
      }

      try {
        const raw = JSON.parse(message.content) as RawLog;
        const entry = this.normalizeLog(raw);
        entries.push(entry);
      } catch (error) {
        // Track failed message to avoid reprocessing
        this.failedMessageIds.set(message.id, Date.now());
        console.warn(`[QueueConsumer] Failed to parse log message ID ${message.id}, skipping`);
      }
    }

    // Limit the size of failedMessageIds to prevent memory leaks (FIFO eviction)
    if (this.failedMessageIds.size > this.MAX_FAILED_IDS) {
      const entries = Array.from(this.failedMessageIds.entries());
      // Sort by timestamp (oldest first)
      entries.sort((a, b) => a[1] - b[1]);
      // Remove oldest 10% of entries
      const toRemove = Math.floor(this.MAX_FAILED_IDS * 0.1);
      for (let i = 0; i < toRemove; i++) {
        this.failedMessageIds.delete(entries[i][0]);
      }
    }

    return entries;
  }

  private normalizeLog(raw: RawLog): LogEntry {
    return {
      id: uuidv4(),
      timestamp: this.parseTimestamp(raw.timestamp),
      level: normalizeLevel(raw.level),
      source: raw.source || 'unknown',
      message: raw.message || JSON.stringify(raw),
      raw: JSON.stringify(raw)
    };
  }

  private parseTimestamp(timestamp: string | number | undefined): string {
    if (!timestamp) {
      return new Date().toISOString();
    }

    if (typeof timestamp === 'number') {
      const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
      return date.toISOString();
    }

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return new Date().toISOString();
    }

    return date.toISOString();
  }

  getStatus(): { isRunning: boolean; consecutiveErrors: number } {
    return {
      isRunning: this.isRunning,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}