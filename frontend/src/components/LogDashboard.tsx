'use client';

import { useState, useEffect } from 'react';
import LogSearch from './LogSearch';
import LogChart from './LogChart';
import LogTable from './LogTable';

interface LogEntry {
  id: string;
  message: string;
  level: string;
  source: string;
  timestamp: string;
}

export default function LogDashboard() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState({ total: 0, byLevel: {}, bySource: {} });
  const [loading, setLoading] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  const searchLogs = async (query: string, filters: Record<string, string>) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query, ...filters });
      const res = await fetch(`${API_URL}/api/logs?${params}`);
      const data = await res.json();
      setLogs(data);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    searchLogs('', {});
    fetch(`${API_URL}/api/logs/stats`)
      .then((res) => res.json())
      .then(setStats)
      .catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      <LogSearch onSearch={searchLogs} loading={loading} />
      <LogChart stats={stats} />
      <LogTable logs={logs} loading={loading} />
    </div>
  );
}
