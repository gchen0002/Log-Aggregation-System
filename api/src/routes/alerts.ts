import { Request, Response, Router } from 'express';
import { AlertRepository } from '../db/alertRepository';
import { AlertService } from '../services/alertService';
import { AlertFilter } from '../types/log';
import { parseQueryInt } from '../utils/queryHelpers';

export function createAlertsRouter(
  alertRepo: AlertRepository,
  alertService: AlertService
): Router {
  const router = Router();

  // GET /api/alerts - List alerts
  router.get('/', (req: Request, res: Response) => {
    try {
      const limit = parseQueryInt(req.query.limit as string, 50, 1, 1000);
      const offset = parseQueryInt(req.query.offset as string, 0, 0);

      const filter: AlertFilter = {
        severity: req.query.severity as string | undefined,
        acknowledged: req.query.acknowledged !== undefined 
          ? req.query.acknowledged === 'true' 
          : undefined,
        limit,
        offset
      };

      const result = alertRepo.findAll(filter);
      res.json({
        alerts: result.alerts,
        total: result.total,
        limit,
        offset
      });
    } catch (error) {
      console.error('Error fetching alerts:', error);
      res.status(500).json({ error: 'Failed to fetch alerts' });
    }
  });

  // GET /api/alerts/stats - Get alert statistics (must be before /:id)
  router.get('/stats', (_req: Request, res: Response) => {
    try {
      const stats = alertRepo.getStats();
      const serviceStatus = alertService.getStatus();
      
      res.json({
        ...stats,
        monitoring: {
          isRunning: serviceStatus.isRunning,
          lastCheck: serviceStatus.lastCheck,
          config: serviceStatus.config
        }
      });
    } catch (error) {
      console.error('Error fetching alert stats:', error);
      res.status(500).json({ error: 'Failed to fetch alert stats' });
    }
  });

  // GET /api/alerts/:id - Get single alert
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const alert = alertRepo.findById(req.params.id);
      
      if (!alert) {
        res.status(404).json({ error: 'Alert not found' });
        return;
      }

      res.json(alert);
    } catch (error) {
      console.error('Error fetching alert:', error);
      res.status(500).json({ error: 'Failed to fetch alert' });
    }
  });

  // POST /api/alerts/:id/acknowledge - Acknowledge alert
  router.post('/:id/acknowledge', (req: Request, res: Response) => {
    try {
      const success = alertRepo.acknowledge(req.params.id);
      
      if (!success) {
        res.status(404).json({ error: 'Alert not found' });
        return;
      }

      res.json({ success: true, acknowledged: true });
    } catch (error) {
      console.error('Error acknowledging alert:', error);
      res.status(500).json({ error: 'Failed to acknowledge alert' });
    }
  });

  // DELETE /api/alerts - Delete old acknowledged alerts
  router.delete('/', (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.olderThanDays as string) || 30;
      
      if (days <= 0) {
        res.status(400).json({ error: 'olderThanDays must be a positive number' });
        return;
      }
      
      const deleted = alertRepo.deleteOldAlerts(days);
      res.json({ deleted, olderThanDays: days });
    } catch (error) {
      console.error('Error deleting old alerts:', error);
      res.status(500).json({ error: 'Failed to delete old alerts' });
    }
  });

  // DELETE /api/alerts/acknowledged - Delete all acknowledged alerts
  router.delete('/acknowledged', (_req: Request, res: Response) => {
    try {
      const deleted = alertRepo.deleteAcknowledged();
      res.json({ deleted });
    } catch (error) {
      console.error('Error deleting acknowledged alerts:', error);
      res.status(500).json({ error: 'Failed to delete acknowledged alerts' });
    }
  });

  return router;
}
