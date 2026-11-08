import type { ErrorBody, HealthBody } from '../shared/api';
import { LINES_VERSION, SNAPSHOT_VERSION, type IndexBody, type LinesSnapshot, type Snapshot } from '../shared/api';
import { BUSES, RAIL_REFERENCE, STATIONS } from '../shared/reference/load';
import { EdgeJsonCache, handleBusRoute, handleBusSearch } from './bus';
import { redact } from '../shared/tfl-url';
import { json } from './http';
import { EdgeStationCache, handleStation, onDemandLimiter } from './station';
import { handleLine } from './line';
import { handleNearby } from './nearby';
import { handleLines, handleLinesWithoutStore, handleStatus, handleStatusWithoutStore } from './status';
import { D1Store } from './store';
import { createTflClient } from './tfl/client';

/**
 * Per-IP limit for on-demand endpoints (ADR-014). True when over the limit. Fails open: a limiter error
 * must not take the app down.
 */
async function overLimit(request: Request, env: Env): Promise<boolean> {
  try {
    const { success } = await env.IP_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
    return !success;
  } catch (err) {
    console.error('rate limiter unavailable:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

const rateLimited = () =>
  json({ error: 'rate_limited' } satisfies ErrorBody, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });

const notFound = () =>
  json({ error: 'not_found' } satisfies ErrorBody, { status: 404, headers: { 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      // A bug, not a TfL failure (those are handled per endpoint): still JSON, never the key.
      console.error('unhandled error:', redact(err instanceof Error ? (err.stack ?? err.message) : String(err)));
      return json({ error: 'internal' } satisfies ErrorBody, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' } satisfies ErrorBody, {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }

  if (url.pathname === '/api/health') {
    const body: HealthBody = {
      status: 'ok',
      serverNow: new Date().toISOString(),
      version: env.CF_VERSION_METADATA?.id ?? 'dev',
      tflKeyConfigured: typeof env.TFL_APP_KEY === 'string' && env.TFL_APP_KEY.length > 0,
    };
    return json(body, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Home screen: statuses only. Check-all: only when the user taps it (ADR-011).
  if (url.pathname === '/api/lines' || url.pathname === '/api/checks') {
    if (!env.TFL_APP_KEY) {
      return json({ error: 'not_configured' } satisfies ErrorBody, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    const now = Date.now();
    const tfl = () => createTflClient(env.TFL_APP_KEY);
    const waitUntil = (p: Promise<unknown>) => ctx.waitUntil(p);
    const checks = new D1Store<Snapshot>(env.DB, 'checks', SNAPSHOT_VERSION);
    try {
      return url.pathname === '/api/lines'
        ? await handleLines({ store: new D1Store<LinesSnapshot>(env.DB, 'lines', LINES_VERSION), checks, tfl, reference: RAIL_REFERENCE, now, waitUntil })
        : await handleStatus({ store: checks, tfl, reference: RAIL_REFERENCE, now, waitUntil });
    } catch (err) {
      console.error('store unavailable, calling TfL directly:', redact(err instanceof Error ? err.message : String(err)));
      return url.pathname === '/api/lines'
        ? handleLinesWithoutStore(tfl, RAIL_REFERENCE, now)
        : handleStatusWithoutStore(tfl, RAIL_REFERENCE, now);
    }
  }

  const lineMatch = /^\/api\/line\/([a-z-]{2,30})$/.exec(url.pathname);
  if (lineMatch) {
    if (await overLimit(request, env)) return rateLimited();
    if (!env.TFL_APP_KEY) {
      return json({ error: 'not_configured' } satisfies ErrorBody, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    return handleLine({
      lineId: lineMatch[1]!,
      reference: RAIL_REFERENCE,
      cache: new EdgeJsonCache(),
      limiter: onDemandLimiter,
      tfl: () => createTflClient(env.TFL_APP_KEY),
      now: Date.now(),
    });
  }

  if (url.pathname === '/api/index') {
    const body: IndexBody = {
      stations: STATIONS.stations.map(({ id, name, lines, lat, lon }) => ({ id, name, lines, lat, lon })),
      routes: BUSES.routes,
    };
    return json(body, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  }

  const station = /^\/api\/station\/([A-Za-z0-9]{3,20})$/.exec(url.pathname);
  const bus = /^\/api\/bus\/([A-Za-z0-9]{1,6})$/.exec(url.pathname);
  const nearby = url.pathname === '/api/nearby';
  if (station || bus || nearby || url.pathname === '/api/search') {
    if (await overLimit(request, env)) return rateLimited();
    if (!env.TFL_APP_KEY) {
      return json({ error: 'not_configured' } satisfies ErrorBody, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    const tfl = () => createTflClient(env.TFL_APP_KEY);
    const now = Date.now();
    if (nearby) {
      return handleNearby(url.searchParams.get('lat'), url.searchParams.get('lon'), {
        stations: STATIONS,
        buses: BUSES,
        reference: RAIL_REFERENCE,
        cache: new EdgeJsonCache(),
        stationCache: new EdgeStationCache(),
        limiter: onDemandLimiter,
        tfl,
        now,
      });
    }
    if (station) {
      return handleStation({
        id: station[1]!,
        stations: STATIONS,
        buses: BUSES,
        reference: RAIL_REFERENCE,
        cache: new EdgeStationCache(),
        limiter: onDemandLimiter,
        tfl,
        now,
      });
    }
    const deps = { buses: BUSES, cache: new EdgeJsonCache(), limiter: onDemandLimiter, tfl, now };
    return bus ? handleBusRoute(bus[1]!, deps) : handleBusSearch(url.searchParams.get('q'), deps);
  }

  return notFound();
}
