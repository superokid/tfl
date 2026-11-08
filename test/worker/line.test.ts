import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLineBody, type LineBody } from '../../src/shared/api';
import { LIVE } from '../../src/shared/config';
import { RAIL_REFERENCE } from '../../src/shared/reference/load';
import { MemoryJsonCache } from '../../src/worker/bus';
import { handleLine, type LineDeps } from '../../src/worker/line';
import { CallLimiter } from '../../src/worker/station';
import { createTflClient } from '../../src/worker/tfl/client';

const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8')).body;
const NOW = Date.parse('2026-11-08T12:12:00Z');

function fakeTfl(down = false) {
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    if (down) return new Response('{}', { status: 503 });
    const name = url.pathname.endsWith('/Status') ? 'status-rail' : 'arr-victoria-oxford-circus';
    return new Response(JSON.stringify(fixture(name)));
  }) as typeof fetch;
  return { seen, client: () => createTflClient('NOT-A-REAL-KEY-NOT-A-REAL-KEY', fetchImpl) };
}

function setup(cache = new MemoryJsonCache()) {
  const background: Promise<unknown>[] = [];
  const deps = (tfl: ReturnType<typeof fakeTfl>, now: number): LineDeps => ({
    lineId: 'victoria',
    reference: RAIL_REFERENCE,
    cache,
    limiter: new CallLimiter(LIVE.stationCallsPerMinute),
    tfl: tfl.client,
    now,
    waitUntil: (p) => void background.push(p),
  });
  return { cache, background, deps };
}

async function body(res: Response): Promise<LineBody> {
  const b: unknown = await res.json();
  expect(isLineBody(b)).toBe(true);
  return b as LineBody;
}

describe('/api/line/:id', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('nothing cached: checks inline', async () => {
    const { deps } = setup();
    const tfl = fakeTfl();
    const b = await body(await handleLine(deps(tfl, NOW)));
    expect(tfl.seen).toContain('/Line/victoria/Status');
    expect(b.checkedAt).toBe(NOW);
    expect(b.stale).toBe(false);
  });

  it('cached and fresh: no TfL call', async () => {
    const s = setup();
    await handleLine(s.deps(fakeTfl(), NOW));
    const tfl = fakeTfl();
    await handleLine(s.deps(tfl, NOW + LIVE.stationFreshMs - 1));
    expect(tfl.seen).toHaveLength(0);
    expect(s.background).toHaveLength(0);
  });

  it('cached, past fresh but within the revalidate window: answers at once, refreshes in the background', async () => {
    const s = setup();
    await handleLine(s.deps(fakeTfl(), NOW));
    const tfl = fakeTfl();
    const later = NOW + LIVE.stationFreshMs + 5_000;
    const b = await body(await handleLine(s.deps(tfl, later)));
    expect(b.checkedAt).toBe(NOW); // the cached copy, with its real age
    expect(b.stale).toBe(false);
    expect(s.background).toHaveLength(1);
    await Promise.all(s.background);
    expect(tfl.seen).toContain('/Line/victoria/Status');
    const next = await body(await handleLine(s.deps(fakeTfl(), later + 1)));
    expect(next.checkedAt).toBe(later);
  });

  it('cached copy older than the revalidate window: checks inline', async () => {
    const s = setup();
    await handleLine(s.deps(fakeTfl(), NOW));
    const tfl = fakeTfl();
    const later = NOW + LIVE.staleWhileRevalidateMs;
    const b = await body(await handleLine(s.deps(tfl, later)));
    expect(b.checkedAt).toBe(later);
    expect(s.background).toHaveLength(0);
  });

  it('background refresh fails: the cached copy is kept, nothing thrown', async () => {
    const s = setup();
    await handleLine(s.deps(fakeTfl(), NOW));
    const later = NOW + LIVE.stationFreshMs + 5_000;
    await handleLine(s.deps(fakeTfl(true), later));
    await expect(Promise.all(s.background)).resolves.toBeDefined();
    const b = await body(await handleLine(s.deps(fakeTfl(), later + 1)));
    expect(b.checkedAt).toBe(NOW);
  });

  it('TfL down, old copy cached: served marked stale; nothing cached → 503', async () => {
    const s = setup();
    await handleLine(s.deps(fakeTfl(), NOW));
    const b = await body(await handleLine(s.deps(fakeTfl(true), NOW + LIVE.staleWhileRevalidateMs)));
    expect(b.stale).toBe(true);
    const empty = setup();
    expect((await handleLine(empty.deps(fakeTfl(true), NOW))).status).toBe(503);
  });
});
