/**
 * GET /api/station/:id: live departures at any rail station, on demand (ADR-008, footprint ADR-009). One TfL call per
 * stop id at the station (≤ 4), cached 30 s per data centre, limited per Worker instance in memory (no D1
 * writes). If TfL fails, the last good copy is served marked stale.
 */
import type { ErrorBody, StationBody } from '../shared/api';
import { buildBoard } from '../shared/boards';
import { LIVE } from '../shared/config';
import type { StationEntry } from '../shared/reference/derive';
import type { BusesFile, ReferenceFile, StationsFile } from '../shared/reference/types';
import type { Prediction } from '../shared/rules/types';
import { redact } from '../shared/tfl-url';
import { json } from './http';
import type { TflClient } from './tfl/client';
import { parseArrivals } from './tfl/parse';

export interface StationCache {
  get(id: string): Promise<StationBody | null>;
  put(id: string, body: StationBody): Promise<void>;
}

/** Cache API: per data centre, may be evicted. Fine for a secondary, short-lived view. */
export class EdgeStationCache implements StationCache {
  private readonly key = (id: string) => `https://station-cache.internal/${encodeURIComponent(id)}`;
  async get(id: string): Promise<StationBody | null> {
    const hit = await caches.default.match(this.key(id));
    return hit ? ((await hit.json()) as StationBody) : null;
  }
  async put(id: string, body: StationBody): Promise<void> {
    const res = new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${LIVE.stationKeepMs / 1000}` },
    });
    await caches.default.put(this.key(id), res);
  }
}

export class MemoryStationCache implements StationCache {
  map = new Map<string, StationBody>();
  async get(id: string) {
    return this.map.get(id) ?? null;
  }
  async put(id: string, body: StationBody) {
    this.map.set(id, structuredClone(body));
  }
}

/** Sliding one-minute window of TfL calls, per Worker instance. Costs nothing on the free tier. */
export class CallLimiter {
  private calls: number[] = [];
  constructor(private readonly perMinute: number) {}
  tryTake(now: number, n: number): boolean {
    this.calls = this.calls.filter((t) => now - t < 60_000);
    if (this.calls.length + n > this.perMinute) return false;
    for (let i = 0; i < n; i++) this.calls.push(now);
    return true;
  }
}

/** One limit for every on-demand TfL call (stations, bus stops, routes, stop search), per instance. */
export const onDemandLimiter = new CallLimiter(LIVE.stationCallsPerMinute);

/** A single bus stop (490000173RC). Stop areas (490G…) return no arrivals, so they're not accepted. */
export const isBusStopId = (id: string) => /^490[0-9]{3,}[A-Z0-9]{0,4}$/.test(id) && !id.startsWith('490G');

/** The letter on a bus stop flag ("RC"); null for odd values TfL sometimes gives ("->W"). */
export const stopLetter = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Z0-9]{1,3}$/.test(s) ? s : null;
};

/**
 * Requests for the same station while a fetch is running share it (per Worker instance), so a cache
 * expiry under load causes one TfL fetch, not a stampede. Found by the load test (scripts/load.ts).
 */
const inFlight = new Map<string, Promise<StationBody | null>>();

export interface StationDeps {
  id: string;
  stations: StationsFile;
  buses: BusesFile;
  reference: ReferenceFile;
  cache: StationCache;
  limiter: CallLimiter;
  tfl: () => TflClient;
  now: number;
}

function respond(body: StationBody, now: number, stale: boolean): Response {
  const maxAge = Math.max(1, Math.round((LIVE.stationFreshMs - (now - body.checkedAt)) / 1000));
  return json({ ...body, serverNow: now, stale } satisfies StationBody, {
    headers: { 'Cache-Control': stale ? 'no-store' : `public, max-age=${maxAge}` },
  });
}

async function fetchStation(station: StationEntry, deps: StationDeps): Promise<StationBody | null> {
  const tfl = deps.tfl();
  const bound = Object.fromEntries(deps.reference.lines.map((l) => [l.lineId, l.boundDirections]));
  let nameFromTfl: string | null = null;
  // A bus stop's arrivals carry its flag letter (platformName) and direction (towards).
  let stop: { letter: string | null; towards: string | null } | null = null;
  const results = await Promise.all(
    station.stopIds.map(async (stopId) => {
      try {
        const body = await tfl.getJson(`/StopPoint/${stopId}/Arrivals`);
        const first: unknown = Array.isArray(body) ? body[0] : null;
        if (first && typeof first === 'object') {
          const a = first as { stationName?: unknown; platformName?: unknown; towards?: unknown };
          if (typeof a.stationName === 'string') nameFromTfl ??= a.stationName;
          if (isBusStopId(stopId)) {
            const towards = typeof a.towards === 'string' ? a.towards.replace(/\s+/g, ' ').trim() : '';
            stop = { letter: stopLetter(a.platformName), towards: towards || null };
          }
        }
        return { stopId, byLine: parseArrivals(body, stopId, bound) };
      } catch (err) {
        console.error('station arrivals failed:', redact(err instanceof Error ? err.message : String(err)));
        return { stopId, byLine: null };
      }
    }),
  );
  if (results.every((r) => r.byLine === null)) return null;

  const names = new Map<string, string>([
    ...deps.buses.routes.map((r): [string, string] => [r.id, r.name]),
    ...deps.reference.lines.map((l): [string, string] => [l.lineId, l.lineName]),
  ]);
  // A bus stop has no index entry: its routes are whatever TfL predicts there, in route order.
  const lineIds = station.lines.length
    ? station.lines
    : [...new Set(results.flatMap((r) => (r.byLine ? [...r.byLine.keys()] : [])))].sort((a, b) =>
        a.localeCompare(b, 'en', { numeric: true }),
      );
  const lines = lineIds.map((lineId) => {
    const answered = results.filter((r) => r.byLine !== null);
    const preds: Prediction[] = answered.flatMap((r) => r.byLine!.get(lineId) ?? []);
    const anyFailed = results.some((r) => r.byLine === null);
    const board = buildBoard(station.id, station.name, preds.length === 0 && anyFailed ? null : preds, deps.now, 6);
    return { lineId, lineName: names.get(lineId) ?? lineId, board };
  });
  const name = station.name || (nameFromTfl as string | null)?.replace(/\s+/g, ' ').trim() || station.id;
  return { stationId: station.id, name, ...(stop ?? {}), checkedAt: deps.now, serverNow: deps.now, stale: false, lines };
}

/** Resolves a station or single bus stop id; undefined if it's neither. */
function resolve(deps: StationDeps): StationEntry | undefined {
  const { id } = deps;
  return deps.stations.stations.find((s) => s.id === id) ?? (isBusStopId(id) ? { id, name: '', stopIds: [id], lines: [] } : undefined);
}

/**
 * Departures for one station or stop: the cached copy if under 30 s old, else one shared fetch; if TfL
 * fails or the limit is hit, the last good copy marked stale. Null when there's nothing to show.
 * Used by /api/station and /api/nearby, so both share one cache and one limit.
 */
export async function loadStation(deps: StationDeps, station = resolve(deps)): Promise<{ body: StationBody; stale: boolean } | null> {
  if (!station) return null;
  const { id, now, cache, limiter } = deps;
  const cached = await cache.get(id).catch(() => null);
  if (cached && now - cached.checkedAt < LIVE.stationFreshMs) return { body: cached, stale: false };

  let pending = inFlight.get(id);
  if (!pending) {
    pending = limiter.tryTake(now, station.stopIds.length)
      ? fetchStation(station, deps).then(async (fresh) => {
          if (fresh) await cache.put(id, fresh).catch(() => {});
          return fresh;
        })
      : Promise.resolve(null);
    inFlight.set(id, pending);
    void pending.finally(() => inFlight.delete(id));
  }
  const fresh = await pending;
  if (fresh) return { body: fresh, stale: false };
  return cached ? { body: cached, stale: true } : null;
}

export async function handleStation(deps: StationDeps): Promise<Response> {
  const station = resolve(deps);
  if (!station) {
    return json({ error: 'unknown_station' } satisfies ErrorBody, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const got = await loadStation(deps, station);
  return got
    ? respond(got.body, deps.now, got.stale)
    : json({ error: 'tfl_unavailable' } satisfies ErrorBody, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });
}
