'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { telemetry } from '../lib/events';
import type { Metrics, Point, LogStats, AlertStats, Detector } from '../lib/model';
function useStateValue() {
  const [paused, setPaused] = useState(false),
    [windowSeconds, setWindowSeconds] = useState(60),
    [history, setHistory] = useState<Point[]>([]);
  const metrics = usePolling<Metrics>('/pipeline-metrics', 2000, paused),
    stats = usePolling<LogStats>('/api/logs/stats', 15000, paused),
    alerts = usePolling<AlertStats>('/api/alerts/stats', 5000, paused),
    detector = usePolling<Detector>('/detector-status', 5000, paused);
  useEffect(() => {
    if (metrics.data && metrics.updatedAt)
      setHistory((old) => {
        if (old.at(-1)?.time === metrics.updatedAt) return old;
        return [
          ...old.filter((p) => p.time > metrics.updatedAt! - 3600000),
          telemetry(metrics.data!, metrics.updatedAt!, old.at(-1)),
        ];
      });
  }, [metrics.data, metrics.updatedAt]);
  return {
    paused,
    setPaused,
    windowSeconds,
    setWindowSeconds,
    metrics: metrics.data,
    metricError: metrics.error,
    updatedAt: metrics.updatedAt,
    stats: stats.data,
    statsError: stats.error,
    alertStats: alerts.data,
    refreshAlerts: alerts.refresh,
    detector: detector.data,
    detectorError: detector.error,
    history,
    point: history.at(-1),
  };
}
const Context = createContext<ReturnType<typeof useStateValue> | null>(null);
export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const state = useStateValue();
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
export function useDashboard() {
  const value = useContext(Context);
  if (!value) throw new Error('Dashboard provider is missing');
  return value;
}
