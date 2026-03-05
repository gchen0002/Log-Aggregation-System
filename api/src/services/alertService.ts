import { v4 as uuidv4 } from 'uuid';
import { AlertRepository } from '../db/alertRepository';
import { LogRepository } from '../db/logRepository';
import { Alert } from '../types/log';

interface ErrorRateThreshold {
  errorsPerMinute: number;
  windowMinutes: number;
}

interface AlertConfig {
  errorRate: ErrorRateThreshold;
  enabled: boolean;
}

export class AlertService {
  private alertRepo: AlertRepository;
  private logRepo: LogRepository;
  private config: AlertConfig;
  private lastCheck: Date;
  private checkInterval: number;
  private isRunning: boolean = false;
  private timeoutId: NodeJS.Timeout | null = null;
  private checkLock: boolean = false;

  constructor(
    alertRepo: AlertRepository,
    logRepo: LogRepository,
    config: Partial<AlertConfig> = {}
  ) {
    this.alertRepo = alertRepo;
    this.logRepo = logRepo;
    this.config = {
      errorRate: {
        errorsPerMinute: 10,
        windowMinutes: 5
      },
      enabled: true,
      ...config
    };
    this.lastCheck = new Date();
    this.checkInterval = 60000; // Check every minute
  }

  start(): void {
    if (this.isRunning || !this.config.enabled) {
      return;
    }

    this.isRunning = true;
    console.log('[AlertService] Starting threshold monitoring...');
    this.check();
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
    console.log('[AlertService] Stopped');
  }

  private async check(): Promise<void> {
    if (!this.isRunning || this.checkLock) {
      return;
    }

    this.checkLock = true;

    try {
      this.checkErrorRate();
      this.lastCheck = new Date();
    } catch (error) {
      console.error('[AlertService] Error during check:', error);
    } finally {
      this.checkLock = false;
    }

    if (this.isRunning) {
      this.timeoutId = setTimeout(() => this.check(), this.checkInterval);
    }
  }

  private checkErrorRate(): void {
    if (this.config.errorRate.windowMinutes <= 0) {
      console.warn('[AlertService] Invalid windowMinutes configuration');
      return;
    }

    const windowStart = new Date(
      Date.now() - this.config.errorRate.windowMinutes * 60 * 1000
    ).toISOString();

    const errorCount = this.logRepo.getErrorCountSince(windowStart);
    const errorsPerMinute = errorCount / this.config.errorRate.windowMinutes;

    if (errorsPerMinute > this.config.errorRate.errorsPerMinute) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const existingAlert = this.alertRepo.findRecentUnacknowledged('high', 'error_rate', since);
      
      if (!existingAlert) {
        this.createErrorRateAlert(errorCount, errorsPerMinute);
      }
    }
  }

  private createErrorRateAlert(errorCount: number, errorsPerMinute: number): void {
    const alert: Alert = {
      id: uuidv4(),
      logId: 'system',
      severity: 'high',
      message: `High error rate detected: ${errorsPerMinute.toFixed(2)} errors/minute (${errorCount} errors in ${this.config.errorRate.windowMinutes} minutes)`,
      details: {
        errorCount,
        errorsPerMinute,
        windowMinutes: this.config.errorRate.windowMinutes,
        threshold: this.config.errorRate.errorsPerMinute,
        type: 'error_rate'
      },
      createdAt: new Date().toISOString(),
      acknowledged: false
    };

    this.alertRepo.create(alert);
    console.log(`[AlertService] Created alert: ${alert.message}`);
  }

  createAlert(alert: Omit<Alert, 'id' | 'createdAt'>): Alert {
    const fullAlert: Alert = {
      ...alert,
      id: uuidv4(),
      createdAt: new Date().toISOString()
    };

    this.alertRepo.create(fullAlert);
    return fullAlert;
  }

  getConfig(): AlertConfig {
    return { ...this.config, errorRate: { ...this.config.errorRate } };
  }

  updateConfig(config: Partial<AlertConfig>): void {
    if (config.enabled !== undefined) {
      this.config.enabled = config.enabled;
    }
    if (config.errorRate) {
      this.config.errorRate = { ...this.config.errorRate, ...config.errorRate };
    }
  }

  getStatus(): { isRunning: boolean; lastCheck: Date; config: AlertConfig } {
    return {
      isRunning: this.isRunning,
      lastCheck: this.lastCheck,
      config: this.getConfig()
    };
  }
}