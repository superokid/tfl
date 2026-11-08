import { useEffect, useId, useMemo, useState } from 'react';
import { type BusSearchBody, type IndexBody, isBusSearchBody, isIndexBody } from '../../../shared/api';
import { lineColour } from '../../lib/lineColours';
import { href } from '../../hooks/route';
import { searchByName, searchRoutes } from '../../lib/view';

/** The search index (stations + bus routes), fetched once per session; the browser caches it a day. */
let indexPromise: Promise<IndexBody | null> | null = null;
export function loadIndex(): Promise<IndexBody | null> {
  indexPromise ??= fetch('/api/index')
    .then((r) => (r.ok ? r.json() : null))
    .then((b: unknown) => (isIndexBody(b) ? b : null))
    .catch(() => null)
    .then((b) => {
      if (!b) indexPromise = null; // retry next time
      return b;
    });
  return indexPromise;
}

/** The index; undefined while loading (or not enabled), null if it couldn't load. */
export function useIndex(enabled: boolean): IndexBody | null | undefined {
  const [index, setIndex] = useState<IndexBody | null>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadIndex().then((b) => live && setIndex(b));
    return () => {
      live = false;
    };
  }, [enabled]);
  return index;
}

/** Bus stops by name: TfL search, from 3 characters, 400 ms after typing stops (cached a day server-side). */
export function useBusStops(query: string): { stops: BusSearchBody['stops']; loading: boolean; failed: boolean } {
  const q = query.trim();
  const [result, setResult] = useState<{ q: string; stops: BusSearchBody['stops']; failed: boolean }>({ q: '', stops: [], failed: false });
  useEffect(() => {
    if (q.length < 3) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: unknown) => setResult(isBusSearchBody(b) ? { q, stops: b.stops, failed: false } : { q, stops: [], failed: true }))
        .catch(() => !controller.signal.aborted && setResult({ q, stops: [], failed: true }));
    }, 400);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q]);
  if (q.length < 3) return { stops: [], loading: false, failed: false };
  return result.q === q ? { ...result, loading: false } : { stops: [], loading: true, failed: false };
}

/** One search box for stations, bus routes and bus stops. */
export function Search() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(false);
  const index = useIndex(active);
  const id = useId();
  const q = query.trim();

  const stations = useMemo(() => (index && q ? searchByName(index.stations, q, 5) : []), [index, q]);
  const routes = useMemo(() => (index && q ? searchRoutes(index.routes, q, 6) : []), [index, q]);
  const routeLike = routes.length > 0 && /\d/.test(q);
  const { stops, loading: stopsLoading, failed: stopsFailed } = useBusStops(routeLike ? '' : q);

  useEffect(() => {
    const clear = () => setQuery('');
    window.addEventListener('hashchange', clear);
    return () => window.removeEventListener('hashchange', clear);
  }, []);

  const first =
    routes[0] && routeLike
      ? href({ page: 'bus', id: routes[0].id })
      : stations[0]
        ? href({ page: 'station', id: stations[0].id })
        : stops[0]
          ? href({ page: 'station', id: stops[0].id })
          : null;
  const nothing = q && index && !stopsLoading && !stopsFailed && stations.length + routes.length + stops.length === 0;

  return (
    <div className="search" role="search">
      <label htmlFor={`${id}-q`} className="visually-hidden">
        Search a station, bus stop or bus route
      </label>
      <input
        id={`${id}-q`}
        type="search"
        inputMode="search"
        placeholder="Station, bus stop or route number"
        autoComplete="off"
        value={query}
        onFocus={() => setActive(true)}
        onChange={(e) => {
          setActive(true);
          setQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && first) location.hash = first.slice(1);
          if (e.key === 'Escape') setQuery('');
        }}
        aria-controls={q ? `${id}-r` : undefined}
      />
      {q && (
        <div id={`${id}-r`} className="results" aria-live="polite">
          {index === undefined && <p className="muted small">Loading…</p>}
          {index === null && <p className="muted small">Can't load stations and routes right now.</p>}
          {routeLike && <ResultGroup title="Bus routes">{routes.map((r) => <Result key={r.id} to={href({ page: 'bus', id: r.id })} badge={r.name} label={`Route ${r.name}`} />)}</ResultGroup>}
          {stations.length > 0 && (
            <ResultGroup title="Stations">
              {stations.map((s) => (
                <Result key={s.id} to={href({ page: 'station', id: s.id })} label={s.name} lines={s.lines} />
              ))}
            </ResultGroup>
          )}
          {!routeLike && (stops.length > 0 || (stopsLoading && q.length >= 3)) && (
            <ResultGroup title="Bus stops">
              {stops.length === 0 ? (
                <p className="muted small">Searching bus stops…</p>
              ) : (
                stops.map((s) => <Result key={s.id} to={href({ page: 'station', id: s.id })} label={s.name} sub={s.towards ? `towards ${s.towards}` : undefined} />)
              )}
            </ResultGroup>
          )}
          {stopsFailed && !routeLike && <p className="muted small">Bus stop search isn't working right now.</p>}
          {nothing && <p className="muted small">Nothing matches "{q}".</p>}
        </div>
      )}
    </div>
  );
}

function ResultGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="results-title">{title}</h3>
      <ul>{children}</ul>
    </section>
  );
}

function Result({ to, label, sub, lines, badge }: { to: string; label: string; sub?: string; lines?: string[]; badge?: string }) {
  return (
    <li>
      <a className="result" href={to}>
        {badge && <span className="route-badge">{badge}</span>}
        <span className="result-text">
          <span>{label}</span>
          {sub && <span className="small muted">{sub}</span>}
        </span>
        {lines && (
          <span className="dots" aria-hidden="true">
            {lines.map((l) => (
              <span key={l} className="dot-line" style={{ background: lineColour(l) }} />
            ))}
          </span>
        )}
      </a>
    </li>
  );
}
