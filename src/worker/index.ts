import type { ErrorBody, HealthBody } from '../shared/api';
import type { IndexBody } from '../shared/api';
import { BUSES, RAIL_REFERENCE, STATIONS } from '../shared/reference/load';
import { EdgeJsonCache, handleBusRoute, handleBusSearch } from './bus';
import { redact } from '../shared/tfl-url';
import { json } from './http';
import { EdgeStationCache, handleStation, onDemandLimiter } from './station';
import { handleStatus, handleStatusWithoutStore } from './status';
import { D1Store } from './store';
import { createTflClient } from './tfl/client';

const notFound = () =>
  json({ error: 'not_found' } satisfies ErrorBody, { status: 404, headers: { 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env, ctx): Promise<Response> {
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

    if (url.pathname === '/api/status') {
      if (!env.TFL_APP_KEY) {
        return json({ error: 'not_configured' } satisfies ErrorBody, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      const now = Date.now();
      const tfl = () => createTflClient(env.TFL_APP_KEY);
      try {
        return await handleStatus({
          store: new D1Store(env.DB),
          tfl,
          reference: RAIL_REFERENCE,
          now,
          waitUntil: (p) => ctx.waitUntil(p),
        });
      } catch (err) {
        console.error('store unavailable, calling TfL directly:', redact(err instanceof Error ? err.message : String(err)));
        return handleStatusWithoutStore(tfl, RAIL_REFERENCE, now);
      }
    }

    if (url.pathname === '/api/index') {
      const body: IndexBody = {
        stations: STATIONS.stations.map(({ id, name, lines }) => ({ id, name, lines })),
        routes: BUSES.routes,
      };
      return json(body, { headers: { 'Cache-Control': 'public, max-age=86400' } });
    }

    const station = /^\/api\/station\/([A-Za-z0-9]{3,20})$/.exec(url.pathname);
    const bus = /^\/api\/bus\/([A-Za-z0-9]{1,6})$/.exec(url.pathname);
    if (station || bus || url.pathname === '/api/search') {
      if (!env.TFL_APP_KEY) {
        return json({ error: 'not_configured' } satisfies ErrorBody, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      const tfl = () => createTflClient(env.TFL_APP_KEY);
      const now = Date.now();
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
  },
} satisfies ExportedHandler<Env>;
