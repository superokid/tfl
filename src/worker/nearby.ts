/**
 * GET /api/nearby?lat&lon (ADR-012): the closest bus stops and their next buses, for a passenger at a stop.
 * Budget: coordinates are rounded to a ~100 m cell; the stop list is cached a day per cell (1 TfL call);
 * each stop's times come from the same 30 s cache and limit as /api/station (≤ 5 calls). No D1 writes.
 * Coordinates are never logged.
 */
import type { ErrorBody, NearbyBody, NearbyStop } from '../shared/api';
import { busRows } from '../shared/boards';
import { LIVE, NEARBY } from '../shared/config';
import type { BusesFile, ReferenceFile, StationsFile } from '../shared/reference/types';
import type { JsonCache } from './bus';
import { json } from './http';
import { type CallLimiter, isBusStopId, loadStation, type StationCache } from './station';
import { TflError, type TflClient } from './tfl/client';

export interface NearbyDeps {
  stations: StationsFile;
  buses: BusesFile;
  reference: ReferenceFile;
  /** Stop lists per cell. */
  cache: JsonCache;
  /** Departures per stop, shared with /api/station. */
  stationCache: StationCache;
  limiter: CallLimiter;
  tfl: () => TflClient;
  now: number;
}

type StopRef = Omit<NearbyStop, 'live' | 'buses'>;

const error = (code: string, status: number) =>
  json({ error: code } satisfies ErrorBody, { status, headers: { 'Cache-Control': 'no-store', ...(status === 503 ? { 'Retry-After': '5' } : {}) } });

/** "51.51543" → 51.515, or null if it isn't a coordinate inside London. */
export function toCell(lat: string | null, lon: string | null): { lat: number; lon: number } | null {
  const f = 10 ** NEARBY.coordDecimals;
  const la = Math.round(Number(lat) * f) / f;
  const lo = Math.round(Number(lon) * f) / f;
  if (!lat || !lon || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  const b = NEARBY.bounds;
  return la >= b.south && la <= b.north && lo >= b.west && lo <= b.east ? { lat: la, lon: lo } : null;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null);

/** TfL /StopPoint?lat&lon → bus stops that some route serves, closest first. */
export function parseNearbyStops(body: unknown, max: number): StopRef[] {
  const points = isObj(body) && Array.isArray(body.stopPoints) ? body.stopPoints : [];
  return points
    .filter(isObj)
    .filter((p) => typeof p.id === 'string' && isBusStopId(p.id) && Array.isArray(p.lines) && p.lines.length > 0)
    .map((p) => {
      const towards = Array.isArray(p.additionalProperties)
        ? p.additionalProperties.filter(isObj).find((a) => a.key === 'Towards')
        : undefined;
      return {
        id: p.id as string,
        name: str(p.commonName) ?? (p.id as string),
        letter: str(p.stopLetter),
        towards: str(towards?.value),
        distanceM: Math.round(typeof p.distance === 'number' ? p.distance : 0),
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, max);
}

async function stopList(cell: { lat: number; lon: number }, deps: NearbyDeps): Promise<StopRef[] | null> {
  const key = `near:${cell.lat},${cell.lon}`;
  const cached = await deps.cache.get<StopRef[]>(key).catch(() => null);
  if (cached) return cached;
  if (!deps.limiter.tryTake(deps.now, 1)) return null;
  try {
    const body = await deps.tfl().getJson('/StopPoint', {
      lat: String(cell.lat),
      lon: String(cell.lon),
      stopTypes: 'NaptanPublicBusCoachTram',
      radius: String(NEARBY.radiusM),
      modes: 'bus',
      returnLines: 'true',
    });
    const stops = parseNearbyStops(body, NEARBY.maxStops);
    await deps.cache.put(key, stops, NEARBY.stopListKeepMs).catch(() => {});
    return stops;
  } catch (err) {
    // The message would hold the URL and its coordinates: log only the kind of error.
    console.error('nearby stops failed:', err instanceof TflError ? err.kind : 'error');
    return null;
  }
}

export async function handleNearby(lat: string | null, lon: string | null, deps: NearbyDeps): Promise<Response> {
  const cell = toCell(lat, lon);
  if (!cell) return error('outside_london', 400);
  const refs = await stopList(cell, deps);
  if (!refs) return error('tfl_unavailable', 503);

  const loaded = await Promise.all(refs.map((r) => loadStation({ ...deps, id: r.id, cache: deps.stationCache })));
  const stops: NearbyStop[] = refs.map((r, i) => {
    const got = loaded[i];
    return { ...r, live: !!got && got.body.lines.every((l) => l.board.live), buses: got ? busRows(got.body.lines, deps.now) : [] };
  });
  const times = loaded.flatMap((g) => (g ? [g.body.checkedAt] : []));
  const checkedAt = times.length ? Math.min(...times) : deps.now;
  const stale = loaded.some((g) => !g || g.stale);
  const maxAge = Math.max(1, Math.round((LIVE.stationFreshMs - (deps.now - checkedAt)) / 1000));
  return json({ stops, checkedAt, serverNow: deps.now, stale } satisfies NearbyBody, {
    headers: { 'Cache-Control': stale ? 'no-store' : `private, max-age=${maxAge}` },
  });
}
