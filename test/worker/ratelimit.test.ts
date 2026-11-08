import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/worker/index';

// On-demand endpoints are limited per client IP before any TfL call (ADR-014).
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

function envWith(limit: (o: { key: string }) => Promise<{ success: boolean }>) {
  return { TFL_APP_KEY: 'NOT-A-REAL-KEY-NOT-A-REAL-KEY', IP_LIMITER: { limit: vi.fn(limit) } } as unknown as Env & {
    IP_LIMITER: { limit: ReturnType<typeof vi.fn> };
  };
}

const get = (path: string, ip = '203.0.113.7') =>
  new Request(`https://example.test${path}`, { headers: { 'CF-Connecting-IP': ip } }) as Request<unknown, IncomingRequestCfProperties>;

afterEach(() => vi.restoreAllMocks());

describe('per-IP limit', () => {
  it.each(['/api/search?q=oxford', '/api/station/940GZZLUOXC', '/api/bus/25', '/api/line/victoria', '/api/nearby?lat=51.5&lon=-0.1'])(
    'answers 429 on %s when the limit is hit, without calling TfL',
    async (path) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const env = envWith(async () => ({ success: false }));

      const res = await worker.fetch(get(path), env, ctx);

      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('60');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'rate_limited' });
      expect(env.IP_LIMITER.limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('lets the request through under the limit', async () => {
    const env = envWith(async () => ({ success: true }));
    const res = await worker.fetch(get('/api/search?q=ab'), env, ctx); // too short: no TfL call
    expect(res.status).toBe(200);
    expect(env.IP_LIMITER.limit).toHaveBeenCalledOnce();
  });

  it('fails open if the limiter itself errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = envWith(async () => {
      throw new Error('binding down');
    });
    const res = await worker.fetch(get('/api/search?q=ab'), env, ctx);
    expect(res.status).toBe(200);
  });

  it.each(['/api/health', '/api/index'])('does not limit %s (no TfL call)', async (path) => {
    const env = envWith(async () => ({ success: false }));
    const res = await worker.fetch(get(path), env, ctx);
    expect(res.status).toBe(200);
    expect(env.IP_LIMITER.limit).not.toHaveBeenCalled();
  });
});
