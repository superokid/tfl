/**
 * GET /api/station/:id: live departures at any rail station, on demand (ADR-009). One TfL call per
 * stop id at the station (≤ 4), cached 30 s per data centre, limited per Worker instance in memory (no D1
 * writes). If TfL fails, the last good copy is served marked stale.
 */
import type { ErrorBody, StationBody } from '../shared/api';
import { buildBoard } from '../shared/boards';
import { LIVE } from '../shared/config';
import type { StationEntry } from '../shared/reference/derive';
import type { ReferenceFile, StationsFile } from '../shared/reference/types';
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

export const stationLimiter = new CallLimiter(LIVE.stationCallsPerMinute);

export interface StationDeps {
  id: string;
  stations: StationsFile;
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
  const results = await Promise.all(
    station.stopIds.map(async (stopId) => {
      try {
        return { stopId, byLine: parseArrivals(await tfl.getJson(`/StopPoint/${stopId}/Arrivals`), stopId, bound) };
      } catch (err) {
        console.error('station arrivals failed:', redact(err instanceof Error ? err.message : String(err)));
        return { stopId, byLine: null };
      }
    }),
  );
  if (results.every((r) => r.byLine === null)) return null;

  const names = new Map(deps.reference.lines.map((l) => [l.lineId, l.lineName]));
  const lines = station.lines.map((lineId) => {
    const answered = results.filter((r) => r.byLine !== null);
    const preds: Prediction[] = answered.flatMap((r) => r.byLine!.get(lineId) ?? []);
    const anyFailed = results.some((r) => r.byLine === null);
    const board = buildBoard(station.id, station.name, preds.length === 0 && anyFailed ? null : preds, deps.now, 6);
    return { lineId, lineName: names.get(lineId) ?? lineId, board };
  });
  return { stationId: station.id, name: station.name, checkedAt: deps.now, serverNow: deps.now, stale: false, lines };
}

export async function handleStation(deps: StationDeps): Promise<Response> {
  const { id, now, cache, limiter } = deps;
  const station = deps.stations.stations.find((s) => s.id === id);
  if (!station) {
    return json({ error: 'unknown_station' } satisfies ErrorBody, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const cached = await cache.get(id).catch(() => null);
  if (cached && now - cached.checkedAt < LIVE.stationFreshMs) return respond(cached, now, false);

  const fresh = limiter.tryTake(now, station.stopIds.length) ? await fetchStation(station, deps) : null;
  if (fresh) {
    await cache.put(id, fresh).catch(() => {});
    return respond(fresh, now, false);
  }
  return cached
    ? respond(cached, now, true)
    : json({ error: 'tfl_unavailable' } satisfies ErrorBody, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });
}
