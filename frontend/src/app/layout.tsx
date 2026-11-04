import type { Metadata } from 'next';
import './globals.css';
import { DashboardProvider } from '../components/DashboardProvider';
import Shell from '../components/Shell';
export const metadata: Metadata = {
  title: 'Explore logs',
  description: 'Search logs, monitor ingestion, and investigate detections.',
  icons: {
    icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DashboardProvider>
          <Shell>{children}</Shell>
        </DashboardProvider>
      </body>
    </html>
  );
}
