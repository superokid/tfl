import type { ErrorBody, HealthBody } from '../shared/api';
import { json } from './http';

export default {
  async fetch(request, env): Promise<Response> {
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

    return json({ error: 'not_found' } satisfies ErrorBody, {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  },
} satisfies ExportedHandler<Env>;
