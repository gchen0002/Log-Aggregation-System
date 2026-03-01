import LogDashboard from '@/components/LogDashboard';

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-bold mb-6">Log Aggregation Dashboard</h1>
      <LogDashboard />
    </main>
  );
}
