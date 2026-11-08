import { describe, expect, it } from 'vitest';
import worker from '../../src/worker/index';
import { isHealthBody } from '../../src/shared/api';

// Deliberately fake and low-entropy so secret scanners don't flag it; distinctive enough to grep for.
const DUMMY_KEY = 'NOT-A-REAL-KEY-NOT-A-REAL-KEY';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    CF_VERSION_METADATA: { id: 'test-version', tag: '', timestamp: '' },
    TFL_APP_KEY: DUMMY_KEY,
    ...overrides,
  } as Env;
}

async function call(path: string, init?: RequestInit, env: Env = makeEnv()): Promise<Response> {
  // A plain Request lacks Cloudflare's incoming `cf` properties; the handler doesn't use them.
  const request = new Request(`https://example.test${path}`, init) as Request<
    unknown,
    IncomingRequestCfProperties
  >;
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  return worker.fetch(request, env, ctx);
}

describe('GET /api/health', () => {
  it('returns a valid health body', async () => {
    const res = await call('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body: unknown = await res.json();
    expect(isHealthBody(body)).toBe(true);
    expect(body).toMatchObject({ status: 'ok', version: 'test-version', tflKeyConfigured: true });
  });

  it('reports a missing key without failing', async () => {
    const res = await call('/api/health', undefined, makeEnv({ TFL_APP_KEY: '' }));
    expect(await res.json()).toMatchObject({ tflKeyConfigured: false });
  });

  it('never exposes the key in the body or headers', async () => {
    const res = await call('/api/health');
    const text = await res.text();
    expect(text).not.toContain(DUMMY_KEY);
    for (const [, value] of res.headers) expect(value).not.toContain(DUMMY_KEY);
  });
});

describe('security headers', () => {
  it('every API response is locked down', async () => {
    for (const path of ['/api/health', '/api/nope']) {
      const res = await call(path);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'");
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    }
  });

  it('the static site ships a strict CSP: scripts only from self, no inline scripts', async () => {
    const { readFileSync } = await import('node:fs');
    const headers = readFileSync('public/_headers', 'utf8');
    expect(headers).toContain("script-src 'self'");
    expect(headers).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(headers).toContain("frame-ancestors 'none'");
  });
});

describe('other routes', () => {
  it('returns JSON 404 for unknown API paths', async () => {
    const res = await call('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('rejects non-GET methods', async () => {
    const res = await call('/api/health', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, HEAD');
  });
});
