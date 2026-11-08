import { useCallback, useEffect, useRef, useState } from 'react';
import { isStationBody, type StationBody } from '../shared/api';
import { REFRESH_MS } from './useStatus';
import type { SearchableStation } from './view';

/** `#station/<id>` → that station's id, else null. Hash routing keeps every view a static-asset page. */
export function useStationRoute(): [string | null, (id: string | null) => void] {
  const read = () => {
    const m = /^#station\/([A-Za-z0-9]{3,20})$/.exec(location.hash);
    return m ? m[1]! : null;
  };
  const [id, setId] = useState<string | null>(read);
  useEffect(() => {
    const onHash = () => setId(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((next: string | null) => {
    location.hash = next ? `station/${next}` : '';
    window.scrollTo(0, 0);
  }, []);
  return [id, go];
}

/** The station index, fetched once on first use (the browser caches it for a day). */
export function useStationIndex(enabled: boolean): SearchableStation[] | null {
  const [stations, setStations] = useState<SearchableStation[] | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    fetch('/api/stations')
      .then((r) => (r.ok ? r.json() : null))
      .then((b: unknown) => {
        const list = (b as { stations?: unknown } | null)?.stations;
        if (Array.isArray(list)) setStations(list as SearchableStation[]);
        else started.current = false;
      })
      .catch(() => {
        started.current = false;
      });
  }, [enabled]);
  return stations;
}

export interface StationState {
  data: StationBody | null;
  receivedAt: number;
  error: string | null;
  loading: boolean;
}

/** Live departures for one station: now, then every 60 s while visible and not paused (ADR-009). */
export function useStation(id: string, paused: boolean) {
  const [state, setState] = useState<StationState>({ data: null, receivedAt: 0, error: null, loading: true });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/station/${id}`, { signal: AbortSignal.timeout(12_000) });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || !isStationBody(body)) throw new Error(res.status === 404 ? 'Unknown station' : `HTTP ${res.status}`);
      setState({ data: body, receivedAt: Date.now(), error: null, loading: false });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : 'Failed' }));
    }
  }, [id]);

  useEffect(() => {
    const first = setTimeout(() => {
      setState({ data: null, receivedAt: 0, error: null, loading: true });
      void load();
    }, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !paused) void load();
    }, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, paused]);

  return { ...state, reload: load };
}
