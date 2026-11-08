import { afterEach, describe, expect, it, vi } from 'vitest';

// Any handler throwing something unexpected (a bug, a runtime error) must still answer in JSON, with no key.
vi.mock('../../src/worker/line', () => ({
  handleLine: () => {
    throw new Error('boom https://api.tfl.gov.uk/Line?app_key=NOT-A-REAL-KEY-NOT-A-REAL-KEY');
  },
}));

const { default: worker } = await import('../../src/worker/index');

afterEach(() => vi.restoreAllMocks());

describe('unexpected errors', () => {
  it('returns a JSON 500 and logs only a redacted message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { TFL_APP_KEY: 'NOT-A-REAL-KEY-NOT-A-REAL-KEY' } as Env;
    const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
    const req = new Request('https://example.test/api/line/victoria') as Request<unknown, IncomingRequestCfProperties>;

    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'internal' });
    expect(text).not.toContain('NOT-A-REAL-KEY');
    const logged = log.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('app_key=REDACTED');
    expect(logged).not.toContain('NOT-A-REAL-KEY');
  });
});
