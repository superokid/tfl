/**
 * Bus endpoints, all on demand (ADR-011): stop search, and a route's status with live times at every stop. Each is cached at the edge and
 * shares the per-instance on-demand limit; none writes to D1.
 */
import type { BusRouteBody, BusSearchBody, BusStopMatch, ErrorBody, RouteDirection, RouteStop } from '../shared/api';
import { lineMessages } from '../shared/boards';
import { LIVE } from '../shared/config';
import type { BusesFile } from '../shared/reference/types';
import { activeStatuses } from '../shared/rules/status';
import { redact } from '../shared/tfl-url';
import { json } from './http';
import { type CallLimiter, isBusStopId } from './station';
import { TflError, type TflClient } from './tfl/client';
import { parseStatuses } from './tfl/parse';

export interface JsonCache {
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown, ttlMs: number): Promise<void>;
}

export class EdgeJsonCache implements JsonCache {
  private readonly url = (key: string) => `https://json-cache.internal/${encodeURIComponent(key)}`;
  async get<T>(key: string): Promise<T | null> {
    const hit = await caches.default.match(this.url(key));
    return hit ? ((await hit.json()) as T) : null;
  }
  async put(key: string, value: unknown, ttlMs: number): Promise<void> {
    await caches.default.put(
      this.url(key),
      new Response(JSON.stringify(value), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${Math.round(ttlMs / 1000)}` },
      }),
    );
  }
}

export class MemoryJsonCache implements JsonCache {
  map = new Map<string, unknown>();
  async get<T>(key: string) {
    return (this.map.get(key) as T | undefined) ?? null;
  }
  async put(key: string, value: unknown) {
    this.map.set(key, structuredClone(value));
  }
}

export interface BusDeps {
  buses: BusesFile;
  cache: JsonCache;
  limiter: CallLimiter;
  tfl: () => TflClient;
  now: number;
}

const DAY = 86_400_000;
const unavailable = () =>
  json({ error: 'tfl_unavailable' } satisfies ErrorBody, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });

/** Normalised query, or null if too short/long to be worth a TfL call. */
export function normaliseQuery(q: string | null): string | null {
  const n = (q ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return n.length >= 3 && n.length <= 40 ? n : null;
}

export async function handleBusSearch(q: string | null, deps: BusDeps): Promise<Response> {
  const query = normaliseQuery(q);
  if (!query) return json({ query: q ?? '', stops: [] } satisfies BusSearchBody, { headers: { 'Cache-Control': 'no-store' } });
  const key = `search:${query}`;
  const cached = await deps.cache.get<BusSearchBody>(key).catch(() => null);
  const ok = (body: BusSearchBody) => json(body, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  if (cached) return ok(cached);
  if (!deps.limiter.tryTake(deps.now, 1)) return unavailable();
  try {
    const body = await deps.tfl().getJson(`/StopPoint/Search/${encodeURIComponent(query)}`, { modes: 'bus', maxResults: '20' });
    const matches = typeof body === 'object' && body !== null ? (body as { matches?: unknown }).matches : null;
    const stops: BusStopMatch[] = (Array.isArray(matches) ? matches : [])
      .map((m) => m as { id?: unknown; name?: unknown; towards?: unknown })
      .filter((m) => typeof m.id === 'string' && isBusStopId(m.id) && typeof m.name === 'string')
      .slice(0, 12)
      .map((m) => ({ id: m.id as string, name: m.name as string, towards: typeof m.towards === 'string' && m.towards ? m.towards : null }));
    const result: BusSearchBody = { query, stops };
    await deps.cache.put(key, result, DAY).catch(() => {});
    return ok(result);
  } catch (err) {
    console.error('bus search failed:', redact(err instanceof Error ? err.message : String(err)));
    return unavailable();
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export type RouteStopRef = Omit<RouteStop, 'arrivals'>;

/** A route sequence → its stops in order: the longest ordered route, names from the stop list. */
export function routeStops(body: unknown): RouteStopRef[] {
  if (!isObj(body)) return [];
  const info = new Map<string, { name: string; letter: string | null }>();
  for (const seq of Array.isArray(body.stopPointSequences) ? body.stopPointSequences : []) {
    if (!isObj(seq) || !Array.isArray(seq.stopPoint)) continue;
    for (const p of seq.stopPoint) {
      if (!isObj(p)) continue;
      const id = str(p.id);
      const name = str(p.name);
      if (id && name) info.set(id, { name: name.replace(/\s+/g, ' ').trim(), letter: str(p.stopLetter) });
    }
  }
  const routes = (Array.isArray(body.orderedLineRoutes) ? body.orderedLineRoutes : [])
    .map((r) => (isObj(r) && Array.isArray(r.naptanIds) ? r.naptanIds.filter((x): x is string => typeof x === 'string') : []))
    .sort((a, b) => b.length - a.length);
  return (routes[0] ?? []).filter((id) => info.has(id)).map((id) => ({ id, ...info.get(id)! }));
}

/** /Line/{route}/Arrivals → next buses per stop (epoch ms, soonest first, at most `perStop`). */
export function arrivalsByStop(body: unknown, now: number, perStop = 3): Map<string, number[]> {
  if (!Array.isArray(body)) throw new TflError('invalid', 'route arrivals: expected an array');
  const byStop = new Map<string, Map<string, number>>();
  for (const a of body) {
    if (!isObj(a)) continue;
    const stop = str(a.naptanId);
    const vehicle = str(a.vehicleId) ?? str(a.id);
    const t = typeof a.expectedArrival === 'string' ? Date.parse(a.expectedArrival) : NaN;
    if (!stop || !vehicle || Number.isNaN(t) || t < now - 30_000) continue;
    const m = byStop.get(stop) ?? new Map<string, number>();
    m.set(vehicle, Math.min(m.get(vehicle) ?? Infinity, t));
    byStop.set(stop, m);
  }
  return new Map([...byStop].map(([stop, m]) => [stop, [...m.values()].sort((a, b) => a - b).slice(0, perStop)]));
}

const DIRECTIONS = ['outbound', 'inbound'] as const;
const routeInFlight = new Map<string, Promise<BusRouteBody | null>>();

/**
 * One route: status + every stop in order with its next buses, in ONE response (one Worker request per
 * refresh). TfL calls on a cache miss: status + arrivals (2), plus the stop order only when its 1-day
 * cache is cold (2). Edge cache 30 s, shared in-flight fetch, no D1 writes (ADR-009/011).
 */
export async function handleBusRoute(routeId: string, deps: BusDeps): Promise<Response> {
  const route = deps.buses.routes.find((r) => r.id === routeId.toLowerCase());
  if (!route) return json({ error: 'unknown_route' } satisfies ErrorBody, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const key = `bus2:${route.id}`;
  const respond = (b: BusRouteBody, stale: boolean) => {
    const maxAge = Math.max(1, Math.round((LIVE.stationFreshMs - (deps.now - b.checkedAt)) / 1000));
    return json({ ...b, serverNow: deps.now, stale } satisfies BusRouteBody, {
      headers: { 'Cache-Control': stale ? 'no-store' : `public, max-age=${maxAge}` },
    });
  };

  const cached = await deps.cache.get<BusRouteBody>(key).catch(() => null);
  if (cached && deps.now - cached.checkedAt < LIVE.stationFreshMs) return respond(cached, false);

  let pending = routeInFlight.get(key);
  if (!pending) {
    pending = fetchRoute(route, deps)
      .then(async (b) => {
        if (b) await deps.cache.put(key, b, LIVE.stationKeepMs).catch(() => {});
        return b;
      })
      .catch((err: unknown) => {
        console.error('bus route failed:', redact(err instanceof Error ? err.message : String(err)));
        return null;
      });
    routeInFlight.set(key, pending);
    void pending.finally(() => routeInFlight.delete(key));
  }
  const fresh = await pending;
  if (fresh) return respond(fresh, false);
  return cached ? respond(cached, true) : unavailable();
}

async function fetchRoute(route: BusesFile['routes'][number], deps: BusDeps): Promise<BusRouteBody | null> {
  const seqKey = (d: string) => `busseq:${route.id}:${d}`;
  const cachedSeqs = await Promise.all(DIRECTIONS.map((d) => deps.cache.get<RouteStopRef[]>(seqKey(d)).catch(() => null)));
  const missing = DIRECTIONS.filter((_, i) => !cachedSeqs[i]);
  if (!deps.limiter.tryTake(deps.now, 2 + missing.length)) return null;

  const tfl = deps.tfl();
  const [status, arrivals, ...seqs] = await Promise.allSettled([
    tfl.getJson(`/Line/${route.id}/Status`),
    tfl.getJson(`/Line/${route.id}/Arrivals`),
    ...DIRECTIONS.map((d, i) => (cachedSeqs[i] ? Promise.resolve(cachedSeqs[i]) : tfl.getJson(`/Line/${route.id}/Route/Sequence/${d}`).then(routeStops))),
  ]);
  if (status.status === 'rejected' && arrivals.status === 'rejected') return null;

  // An unreadable status or arrivals body loses only that part: the stops still show.
  const attempt = <T>(f: () => T): T | null => {
    try {
      return f();
    } catch {
      return null;
    }
  };
  const statuses =
    status.status === 'fulfilled' ? activeStatuses(attempt(() => parseStatuses(status.value).get(route.id)) ?? [], deps.now) : [];
  const times = arrivals.status === 'fulfilled' ? attempt(() => arrivalsByStop(arrivals.value, deps.now)) : null;
  const directions: RouteDirection[] = [];
  seqs.forEach((r, i) => {
    const stops = r.status === 'fulfilled' ? (r.value as RouteStopRef[]) : [];
    if (stops.length === 0) return;
    if (!cachedSeqs[i]) void deps.cache.put(seqKey(DIRECTIONS[i]!), stops, DAY).catch(() => {});
    directions.push({
      id: DIRECTIONS[i]!,
      towards: stops[stops.length - 1]!.name,
      stops: stops.map((s) => ({ ...s, arrivals: times?.get(s.id) ?? [] })),
    });
  });

  return {
    routeId: route.id,
    name: route.name,
    statuses: [...new Set(statuses.map((s) => s.description))],
    messages: lineMessages(route.name, statuses.map((s) => s.reason)),
    directions,
    timesLive: times !== null,
    checkedAt: deps.now,
    serverNow: deps.now,
    stale: false,
  };
}
