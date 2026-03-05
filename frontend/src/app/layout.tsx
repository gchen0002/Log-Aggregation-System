import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Log Aggregation System',
  description: 'Distributed log aggregation dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
