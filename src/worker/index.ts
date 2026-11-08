import type { ErrorBody, HealthBody } from '../shared/api';
import { RAIL_REFERENCE } from '../shared/reference/load';
import { redact } from '../shared/tfl-url';
import { json } from './http';
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

    return notFound();
  },
} satisfies ExportedHandler<Env>;
