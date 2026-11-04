import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import AlertsPage from '../src/components/AlertsPage';
import AlertRelatedLogs from '../src/components/AlertRelatedLogs';
const state = vi.hoisted(() => ({ refreshAlerts: vi.fn(), paused: false }));
vi.mock('../src/components/DashboardProvider', () => ({
  useDashboard: () => ({
    paused: state.paused,
    stats: { bySource: { auth: 2, worker: 1 } },
    alertStats: { total: 2, unacknowledged: 2 },
    refreshAlerts: state.refreshAlerts,
  }),
}));
const alert = {
  id: 'a',
  logId: 'anchor',
  severity: 'high',
  message: 'Original detector message',
  createdAt: '2026-10-22T16:23:47Z',
  acknowledged: false,
  details: { errorsPerMinute: 40, threshold: 10, windowMinutes: 5, errorCount: 200 },
};
const logs = [
  {
    id: 'one',
    source: 'auth',
    level: 'error',
    timestamp: '2026-10-22T16:23:46Z',
    message: 'timeout latency=205ms',
  },
  {
    id: 'two',
    source: 'worker',
    level: 'error',
    timestamp: '2026-10-22T16:23:45Z',
    message: 'timeout',
    raw: '{"latency_ms":38,"request_id":"real-request"}',
  },
];
const response = (value: unknown) => ({ ok: true, json: async () => value }) as Response;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('alert investigation', () => {
  it('selects real log fields and retains detection filters in Explore links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ logs })),
    );
    render(<AlertRelatedLogs alert={alert} />);
    const inspector = await screen.findByRole('region', { name: 'Selected related log' });
    fireEvent.click(screen.getByRole('button', { name: /Inspect error event from worker/ }));
    expect(within(inspector).getByText('38 ms')).toBeTruthy();
    expect(within(inspector).getByText('"real-request"')).toBeTruthy();
    const link = within(inspector).getByRole('link', { name: /Open in Explore/ });
    const params = new URL(link.getAttribute('href')!, location.origin).searchParams;
    expect(params.get('logId')).toBe('two');
    expect(params.get('level')).toBe('error');
    expect(params.get('source')).toBeNull();
  });
  it('retries unavailable evidence without inventing empty successful data', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue(response({ logs: [] })),
    );
    render(<AlertRelatedLogs alert={alert} />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry related events' }));
    await screen.findByText('No retained events match this detection window.');
  });
  it('acknowledges on the server and refreshes global alert counts', async () => {
    let ack = false;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        ack = true;
        return response({ acknowledged: true });
      }
      return response(
        url.startsWith('/api/alerts?')
          ? { alerts: ack ? [] : [alert], total: ack ? 0 : 1 }
          : { logs },
      );
    });
    vi.stubGlobal('fetch', fetch);
    render(<AlertsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge', exact: true }));
    await screen.findByText('No open alerts');
    expect(
      fetch.mock.calls.some(
        ([url, init]) => url === '/api/alerts/a/acknowledge' && init?.method === 'POST',
      ),
    ).toBe(true);
    expect(state.refreshAlerts).toHaveBeenCalled();
  });
  it('preserves an active investigation while newer detections arrive', async () => {
    vi.useFakeTimers();
    let newer = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        response(
          url.startsWith('/api/alerts?')
            ? {
                alerts: newer
                  ? [
                      { ...alert, id: 'new', details: { ...alert.details, errorsPerMinute: 70 } },
                      alert,
                    ]
                  : [alert],
                total: newer ? 2 : 1,
              }
            : { logs },
        ),
      ),
    );
    const view = await act(async () => render(<AlertsPage />));
    expect(view.container.querySelector('.observed-metric strong')?.textContent).toBe('40');
    newer = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText('70 errors/min')).toBeTruthy();
    expect(view.container.querySelector('.observed-metric strong')?.textContent).toBe('40');
  });
  it('returns from a depleted last page after acknowledgment', async () => {
    let ack = false;
    const retained = Array.from({ length: 25 }, (_, i) => ({ ...alert, id: 'retained-' + i }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          ack = true;
          return response({ acknowledged: true });
        }
        if (url.startsWith('/api/alerts?'))
          return response({
            alerts:
              new URL(url, location.origin).searchParams.get('offset') === '25'
                ? ack
                  ? []
                  : [{ ...alert, id: 'last' }]
                : retained,
            total: ack ? 25 : 26,
          });
        return response({ logs });
      }),
    );
    render(<AlertsPage />);
    await screen.findByText('Showing 1–25 of 26 alerts');
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await screen.findByText('Showing 26–26 of 26 alerts');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge', exact: true }));
    await screen.findByText('Showing 1–25 of 25 alerts');
    await waitFor(() =>
      expect(screen.getAllByRole('complementary', { name: 'Selected alert details' })).toHaveLength(
        1,
      ),
    );
  });
});
