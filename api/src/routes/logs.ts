import { Request, Response, Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { LogRepository } from '../db/logRepository';
import { LogEntry, SearchParams } from '../types/log';
import { parseQueryInt } from '../utils/queryHelpers';
import { normalizeLevel } from '../utils/logNormalizer';

export function createLogsRouter(logRepo: LogRepository): Router {
  const router = Router();

  // POST /api/logs - Ingest logs directly
  router.post('/', (req: Request, res: Response) => {
    try {
      const { timestamp, level, source, message, raw } = req.body;

      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Message is required and must be a string' });
        return;
      }

      if (message.length > 10000) {
        res.status(400).json({ error: 'Message exceeds maximum length of 10000 characters' });
        return;
      }

      // Validate source field
      const validatedSource = (typeof source === 'string' ? source : 'api').slice(0, 500);

      const entry: LogEntry = {
        id: uuidv4(),
        timestamp: validateTimestamp(timestamp) || new Date().toISOString(),
        level: normalizeLevel(level),
        source: validatedSource || 'api',
        message,
        raw: typeof raw === 'string' ? raw : undefined
      };

      logRepo.insert(entry);
      res.status(201).json({ id: entry.id, success: true });
    } catch (error) {
      console.error('Error ingesting log:', error);
      res.status(500).json({ error: 'Failed to ingest log' });
    }
  });

  // GET /api/logs - Search logs
  router.get('/', (req: Request, res: Response) => {
    try {
      const limit = parseQueryInt(req.query.limit as string, 50, 1, 1000);
      const offset = parseQueryInt(req.query.offset as string, 0, 0);

      const params: SearchParams = {
        q: req.query.q as string | undefined,
        level: req.query.level as string | undefined,
        source: req.query.source as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        limit,
        offset
      };

      const result = logRepo.search(params);
      res.json({
        logs: result.logs,
        total: result.total,
        limit,
        offset
      });
    } catch (error) {
      console.error('Error searching logs:', error);
      res.status(500).json({ error: 'Failed to search logs' });
    }
  });

  // GET /api/logs/stats - Get statistics (must be before /:id)
  router.get('/stats', (req: Request, res: Response) => {
    try {
      const hours = Math.max(1, parseInt(req.query.hours as string) || 24);
      const stats = logRepo.getStats(hours);
      res.json({ ...stats, hours });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // GET /api/logs/:id - Get single log
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const log = logRepo.getById(req.params.id);
      
      if (!log) {
        res.status(404).json({ error: 'Log not found' });
        return;
      }

      res.json(log);
    } catch (error) {
      console.error('Error fetching log:', error);
      res.status(500).json({ error: 'Failed to fetch log' });
    }
  });

  // DELETE /api/logs - Delete old logs (maintenance endpoint)
  router.delete('/', (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.olderThanDays as string) || 30;

      if (days <= 0) {
        res.status(400).json({ error: 'olderThanDays must be a positive number' });
        return;
      }

      const deleted = logRepo.deleteOldLogs(days);
      res.json({ deleted, olderThanDays: days });
    } catch (error) {
      console.error('Error deleting old logs:', error);
      res.status(500).json({ error: 'Failed to delete old logs' });
    }
  });

  return router;
}

function validateTimestamp(timestamp: string | undefined): string | null {
  if (!timestamp) return null;
  
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return null;
  
  return date.toISOString();
}