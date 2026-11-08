/**
 * Shared client plumbing: hash routing, idle detection, one "live data" hook for every screen, and the
 * server clock. Free-tier friendly (ADR-009/011): a screen fetches only its own data, every 60 s while
 * visible, and stops after 10 min without interaction.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const REFRESH_MS = 60_000;
export const IDLE_MS = 10 * 60_000;

export type Route =
  | { page: 'home' }
  | { page: 'line'; id: string }
  | { page: 'station'; id: string }
  | { page: 'bus'; id: string };

export function parseRoute(hash: string): Route {
  const m = /^#(line|station|bus)\/([A-Za-z0-9-]{1,30})$/.exec(hash);
  return m ? ({ page: m[1], id: m[2] } as Route) : { page: 'home' };
}

export const href = (r: Route) => (r.page === 'home' ? '#' : `#${r.page}/${r.id}`);

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

/** True after 10 min without the user touching the page; any interaction or tab focus clears it. */
export function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let last = Date.now();
    const active = () => {
      last = Date.now();
      setIdle(false);
    };
    const check = setInterval(() => setIdle(Date.now() - last > IDLE_MS), 30_000);
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, active, { passive: true });
    document.addEventListener('visibilitychange', active);
    return () => {
      clearInterval(check);
      for (const e of events) window.removeEventListener(e, active);
      document.removeEventListener('visibilitychange', active);
    };
  }, []);
  return idle;
}

export interface Live<T> {
  data: T | null;
  /** Local time when `data` arrived (or was saved, for a device copy). */
  receivedAt: number;
  /** 'device' = this phone's last saved copy (offline, or the service unreachable). */
  source: 'live' | 'device' | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

function readSaved<T>(key: string | undefined, valid: (v: unknown) => v is T): { data: T; savedAt: number } | null {
  if (!key) return null;
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? 'null') as { data?: unknown; savedAt?: unknown } | null;
    return p && valid(p.data) && typeof p.savedAt === 'number' ? { data: p.data, savedAt: p.savedAt } : null;
  } catch {
    return null;
  }
}

/**
 * Fetches `url` now and every 60 s while the tab is visible and the user isn't idle. With `saveAs`, the
 * last good result is kept on the device and shown when offline.
 */
export function useLive<T>(
  url: string | null,
  valid: (v: unknown) => v is T,
  opts: { paused?: boolean; saveAs?: string; poll?: boolean } = {},
): Live<T> {
  const { paused = false, saveAs, poll = true } = opts;
  const [state, setState] = useState<Omit<Live<T>, 'reload'>>(() => {
    const saved = readSaved(saveAs, valid);
    return saved
      ? { data: saved.data, receivedAt: saved.savedAt, source: 'device', error: null, loading: true }
      : { data: null, receivedAt: 0, source: null, error: null, loading: true };
  });
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!url) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || !valid(body)) throw new Error(res.status === 404 ? 'Not found' : res.ok ? 'Unexpected response' : `HTTP ${res.status}`);
      if (saveAs) {
        try {
          localStorage.setItem(saveAs, JSON.stringify({ data: body, savedAt: Date.now() }));
        } catch {
          // Storage full or blocked: the app works without it.
        }
      }
      setState({ data: body, receivedAt: Date.now(), source: 'live', error: null, loading: false });
    } catch (err) {
      if (controller.signal.aborted && inFlight.current !== controller) return; // superseded
      const message = !navigator.onLine ? "You're offline" : err instanceof Error && err.name !== 'AbortError' ? err.message : 'Timed out';
      setState((s) => ({ ...s, source: s.data ? 'device' : null, error: message, loading: false }));
    } finally {
      clearTimeout(timer);
    }
  }, [url, valid, saveAs]);

  useEffect(() => {
    // First load from a timer callback: no synchronous setState in the effect body.
    const first = setTimeout(() => {
      setState((s) => (s.data && s.source === 'live' ? s : { ...s, loading: true }));
      void load();
    }, 0);
    const timer = poll
      ? setInterval(() => {
          if (document.visibilityState === 'visible' && !paused) void load();
        }, REFRESH_MS)
      : undefined;
    const onBack = () => document.visibilityState === 'visible' && !paused && void load();
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('online', onBack);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('online', onBack);
      inFlight.current?.abort();
    };
  }, [load, paused, poll]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    void load();
  }, [load]);

  return { ...state, reload };
}

/**
 * The server's clock now: its time at the last fetch plus local time since. Ticks every second, so ages
 * and countdowns stay right even if the phone's clock is off.
 */
export function useServerNow(data: { serverNow: number } | null, receivedAt: number): number | null {
  const [local, setLocal] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setLocal(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return data ? data.serverNow + (local - receivedAt) : null;
}
