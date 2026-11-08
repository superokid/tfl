import { useCallback, useEffect, useRef, useState } from 'react';
import { isStatusBody, type StatusBody } from '../shared/api';

/** Free-tier friendly (ADR-009): every /api call counts against a daily limit shared with other sites. */
export const REFRESH_MS = 60_000;
/** Stop auto-refreshing after this long without the user touching the page; resume on any interaction. */
export const IDLE_MS = 10 * 60_000;
const TIMEOUT_MS = 12_000;
const STORAGE_KEY = 'tfl-status:last';

export type Source = 'live' | 'device';

export interface StatusState {
  data: StatusBody | null;
  /** Where `data` came from: the API, or this device's last saved copy (offline / API down). */
  source: Source | null;
  /** Local time when `data` was received, to keep the age ticking between fetches. */
  receivedAt: number;
  loading: boolean;
  error: string | null;
  /** Auto-refresh paused because nobody has interacted with the page for a while. */
  paused: boolean;
}

function readSaved(): { data: StatusBody; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const p = parsed as { data?: unknown; savedAt?: unknown };
    return isStatusBody(p.data) && typeof p.savedAt === 'number' ? { data: p.data, savedAt: p.savedAt } : null;
  } catch {
    return null;
  }
}

function save(data: StatusBody) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    // Storage can be full or blocked (private mode); the app works without it.
  }
}

/**
 * Fetches /api/status now and every 60 s while the tab is visible and someone has used the page in the
 * last 10 min; falls back to the device copy.
 */
export function useStatus() {
  const [state, setState] = useState<StatusState>(() => {
    const saved = readSaved();
    return saved
      ? { data: saved.data, source: 'device', receivedAt: saved.savedAt, loading: true, error: null, paused: false }
      : { data: null, source: null, receivedAt: 0, loading: true, error: null, paused: false };
  });
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch('/api/status', { signal: controller.signal });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || !isStatusBody(body)) throw new Error(res.ok ? 'Unexpected response' : `HTTP ${res.status}`);
      save(body);
      setState((s) => ({ ...s, data: body, source: 'live', receivedAt: Date.now(), loading: false, error: null }));
    } catch (err) {
      if (controller.signal.aborted && inFlight.current !== controller) return; // superseded
      const message = !navigator.onLine ? "You're offline" : err instanceof Error && err.name !== 'AbortError' ? err.message : 'Timed out';
      setState((s) => {
        const saved = s.data ? null : readSaved();
        return saved
          ? { ...s, data: saved.data, source: 'device', receivedAt: saved.savedAt, loading: false, error: message }
          : { ...s, source: s.data ? 'device' : null, loading: false, error: message };
      });
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    // First load from a timer callback: the effect subscribes to an external source (the API) and never
    // sets state synchronously in its body.
    const first = setTimeout(() => void load(), 0);
    let lastActive = Date.now();
    let paused = false;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActive > IDLE_MS) {
        if (!paused) setState((s) => ({ ...s, paused: (paused = true) }));
        return;
      }
      void load();
    };
    let timer = setInterval(tick, REFRESH_MS);
    const restart = () => {
      clearInterval(timer);
      void load();
      timer = setInterval(tick, REFRESH_MS);
    };
    const onActive = () => {
      lastActive = Date.now();
      if (paused) {
        setState((s) => ({ ...s, paused: (paused = false) }));
        restart();
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      lastActive = Date.now();
      if (paused) setState((s) => ({ ...s, paused: (paused = false) }));
      restart();
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, onActive, { passive: true });
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, onActive);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      inFlight.current?.abort();
    };
  }, [load]);

  /** Manual refresh shows the spinner; the 30 s background refresh stays quiet. */
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return load();
  }, [load]);

  return { ...state, reload };
}

/**
 * The server's clock now, estimated from its time at the last fetch plus local time since. Ticks every
 * second. Using server time keeps ages and arrival countdowns right even if the phone's clock is off.
 */
export function useServerNow(data: { serverNow: number } | null, receivedAt: number): number | null {
  const [local, setLocal] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setLocal(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!data) return null;
  return data.serverNow + (local - receivedAt);
}
