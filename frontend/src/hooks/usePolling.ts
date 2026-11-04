'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../lib/api';
export function usePolling<T>(url: string | null, interval = 2000, paused = false) {
  const [result, setResult] = useState<{ url: string; data: T; at: number } | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const received = useRef<string | null>(null),
    force = useRef(false);
  const refresh = useCallback(() => {
    force.current = true;
    setRevision((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>,
      active = false;
    async function poll() {
      if (
        active ||
        abort.signal.aborted ||
        document.hidden ||
        (paused && received.current === url && !force.current)
      )
        return;
      force.current = false;
      active = true;
      setLoading(true);
      try {
        const data = await requestJson<T>(url!, abort.signal);
        if (!abort.signal.aborted && !document.hidden) {
          received.current = url;
          setResult({ url: url!, data, at: Date.now() });
          setError(null);
        }
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Service unavailable.');
      } finally {
        active = false;
        if (!abort.signal.aborted) {
          setLoading(false);
          if (!paused && interval > 0) timer = setTimeout(poll, interval);
        }
      }
    }
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener('visibilitychange', visible);
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [url, interval, paused, revision]);
  return {
    data: result?.url === url ? result.data : null,
    updatedAt: result?.url === url ? result.at : null,
    error,
    loading,
    refresh,
  };
}
