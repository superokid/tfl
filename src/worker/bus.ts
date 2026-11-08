/**
 * Bus endpoints, all on demand (ADR-010): stop search and route status. Each is cached at the edge and
 * shares the per-instance on-demand limit; none writes to D1.
 */
import type { BusRouteBody, BusSearchBody, BusStopMatch, ErrorBody } from '../shared/api';
import { lineMessages } from '../shared/boards';
import { LIVE } from '../shared/config';
import type { BusesFile } from '../shared/reference/types';
import { activeStatuses } from '../shared/rules/status';
import { redact } from '../shared/tfl-url';
import { json } from './http';
import { type CallLimiter, isBusStopId } from './station';
import type { TflClient } from './tfl/client';
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

export async function handleBusRoute(routeId: string, deps: BusDeps): Promise<Response> {
  const route = deps.buses.routes.find((r) => r.id === routeId.toLowerCase());
  if (!route) return json({ error: 'unknown_route' } satisfies ErrorBody, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const key = `bus:${route.id}`;
  const cached = await deps.cache.get<BusRouteBody>(key).catch(() => null);
  const respond = (b: BusRouteBody, stale: boolean) =>
    json({ ...b, serverNow: deps.now, stale } satisfies BusRouteBody, {
      headers: { 'Cache-Control': stale ? 'no-store' : 'public, max-age=60' },
    });
  if (cached && deps.now - cached.checkedAt < 60_000) return respond(cached, false);
  if (deps.limiter.tryTake(deps.now, 1)) {
    try {
      const statuses = activeStatuses(parseStatuses(await deps.tfl().getJson(`/Line/${route.id}/Status`)).get(route.id) ?? [], deps.now);
      const body: BusRouteBody = {
        routeId: route.id,
        name: route.name,
        statuses: [...new Set(statuses.map((s) => s.description))],
        messages: lineMessages(route.name, statuses.map((s) => s.reason)),
        checkedAt: deps.now,
        serverNow: deps.now,
        stale: false,
      };
      await deps.cache.put(key, body, LIVE.stationKeepMs).catch(() => {});
      return respond(body, false);
    } catch (err) {
      console.error('bus route failed:', redact(err instanceof Error ? err.message : String(err)));
    }
  }
  return cached ? respond(cached, true) : unavailable();
}
