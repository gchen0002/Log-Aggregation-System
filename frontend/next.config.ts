import type { NextConfig } from 'next';
const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:3000',
  detector = process.env.ANOMALY_INTERNAL_URL || 'http://127.0.0.1:5000';
const config: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: api + '/api/:path*' },
      { source: '/pipeline-metrics', destination: api + '/metrics' },
      { source: '/detector-status', destination: detector + '/stats' },
    ];
  },
};
export default config;
