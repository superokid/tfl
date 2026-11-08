/**
 * Shared client plumbing: hash routing, idle detection, one "live data" hook for every screen, and the
 * server clock. Free-tier friendly (ADR-009/011): a screen fetches only its own data, every 60 s while
 * visible, and stops after 10 min without interaction. Nothing is refetched within 30 s unless the user
 * taps Refresh (see lib/recent.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { recall, remember, showDeviceCopyWhileLoading } from '../lib/recent';
import { type LoadFailure, loadErrorText } from '../lib/view';

export const REFRESH_MS = 60_000;
export const IDLE_MS = 10 * 60_000;

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
 * last good result is kept on the device and shown when offline. A copy too old to trust is held back
 * while the first fetch loads (skeleton instead) and shown only if that fetch fails.
 */
export function useLive<T>(
  url: string | null,
  valid: (v: unknown) => v is T,
  opts: { paused?: boolean; saveAs?: string; poll?: boolean } = {},
): Live<T> {
  const { paused = false, saveAs, poll = true } = opts;
  const [state, setState] = useState<Omit<Live<T>, 'reload'>>(() => {
    // Back on a screen seen moments ago: show that result, no request.
    const now = Date.now();
    const hit = url ? recall(url, valid, now) : null;
    if (hit) return { data: hit.data, receivedAt: hit.at, source: 'live', error: null, loading: false };
    const saved = readSaved(saveAs, valid);
    if (saved && showDeviceCopyWhileLoading(saved.savedAt, now))
      return { data: saved.data, receivedAt: saved.savedAt, source: 'device', error: null, loading: true };
    return { data: null, receivedAt: 0, source: null, error: null, loading: true };
  });
  const inFlight = useRef<AbortController | null>(null);

  /** `force`: the user tapped Refresh. Otherwise a result under 30 s old is reused. */
  const load = useCallback(async (force = false) => {
    if (!url) return;
    const hit = force ? null : recall(url, valid, Date.now());
    if (hit) {
      setState((s) =>
        s.source === 'live' && s.receivedAt === hit.at
          ? s
          : { data: hit.data, receivedAt: hit.at, source: 'live', error: null, loading: false },
      );
      return;
    }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12_000);
    let failure: LoadFailure = 'network';
    try {
      const res = await fetch(url, { signal: controller.signal });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || !valid(body)) {
        failure = res.ok ? 'invalid' : res.status;
        throw new Error(String(failure));
      }
      const at = Date.now();
      remember(url, body, at);
      if (saveAs) {
        try {
          localStorage.setItem(saveAs, JSON.stringify({ data: body, savedAt: at }));
        } catch {
          // Storage full or blocked: the app works without it.
        }
      }
      setState({ data: body, receivedAt: at, source: 'live', error: null, loading: false });
    } catch {
      if (controller.signal.aborted && !timedOut) return; // superseded or unmounted
      const message = loadErrorText(!navigator.onLine ? 'offline' : timedOut ? 'timeout' : failure);
      // A copy held back as too old while loading is still better than nothing now.
      const fallback = readSaved(saveAs, valid);
      setState((s) =>
        !s.data && fallback
          ? { data: fallback.data, receivedAt: fallback.savedAt, source: 'device', error: message, loading: false }
          : { ...s, source: s.data ? 'device' : null, error: message, loading: false },
      );
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
    void load(true);
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
