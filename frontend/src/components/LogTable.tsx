'use client';

interface LogEntry {
  id: string;
  message: string;
  level: string;
  source: string;
  timestamp: string;
}

interface LogTableProps {
  logs: LogEntry[];
  loading: boolean;
}

const levelColors: Record<string, string> = {
  debug: 'text-gray-500',
  info: 'text-blue-500',
  warn: 'text-yellow-500',
  error: 'text-red-500',
};

export default function LogTable({ logs, loading }: LogTableProps) {
  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (logs.length === 0) {
    return <div className="text-center py-8 text-gray-500">No logs found</div>;
  }

  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-2 text-left">Timestamp</th>
            <th className="px-4 py-2 text-left">Level</th>
            <th className="px-4 py-2 text-left">Source</th>
            <th className="px-4 py-2 text-left">Message</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-t hover:bg-gray-50">
              <td className="px-4 py-2 text-sm text-gray-500">
                {new Date(log.timestamp).toLocaleString()}
              </td>
              <td className={`px-4 py-2 font-medium ${levelColors[log.level] || ''}`}>
                {log.level.toUpperCase()}
              </td>
              <td className="px-4 py-2">{log.source}</td>
              <td className="px-4 py-2 font-mono text-sm">{log.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
