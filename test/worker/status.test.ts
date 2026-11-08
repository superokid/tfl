import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStatusBody, type Snapshot, type StatusBody } from '../../src/shared/api';
import { LIVE } from '../../src/shared/config';
import { RAIL_REFERENCE } from '../../src/shared/reference/load';
import { buildSnapshot } from '../../src/worker/refresh';
import { handleStatus, handleStatusWithoutStore, plannedCalls, resetMemoForTests, type StatusDeps } from '../../src/worker/status';
import { MemoryStore } from '../../src/worker/store';
import { createTflClient } from '../../src/worker/tfl/client';

const KEY = 'NOT-A-REAL-KEY-NOT-A-REAL-KEY';
const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8')).body;
const NOW = Date.parse('2026-11-08T12:12:00Z'); // when the fixtures were captured

type Behaviour = 'ok' | 'down' | 'invalid' | 'arrivals-down';

/** A fake TfL behind the real client (limiter, timeouts, redaction), serving live fixtures. */
function fakeTfl(behaviour: Behaviour = 'ok') {
  const seen: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.toString());
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    const path = url.pathname;
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (behaviour === 'down') return reply({ message: 'Service Unavailable' }, 503);
    if (path.endsWith('/Status')) {
      if (behaviour === 'invalid') return reply({ unexpected: true });
      return reply(fixture(url.searchParams.get('detail') ? 'status-rail-detail' : 'status-rail'));
    }
    if (path.includes('/Arrivals/')) return behaviour === 'arrivals-down' ? reply({}, 500) : reply([]);
    return reply({}, 404);
  }) as typeof fetch;
  return {
    seen,
    get maxInFlight() {
      return maxInFlight;
    },
    client: () => createTflClient(KEY, fetchImpl),
  };
}

function deps(store: MemoryStore, tfl: ReturnType<typeof fakeTfl>, now = NOW) {
  const background: Promise<unknown>[] = [];
  const d: StatusDeps = { store, tfl: tfl.client, reference: RAIL_REFERENCE, now, waitUntil: (p) => background.push(p) };
  return { d, background };
}

async function body(res: Response): Promise<StatusBody> {
  const b: unknown = await res.json();
  expect(isStatusBody(b)).toBe(true);
  return b as StatusBody;
}

async function seeded(at: number): Promise<MemoryStore> {
  const store = new MemoryStore();
  store.snapshot = await buildSnapshot(fakeTfl().client(), RAIL_REFERENCE, at, null);
  return store;
}

describe('/api/status data layer (ADR-006)', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('first request with no snapshot refreshes inline and stores it', async () => {
    const store = new MemoryStore();
    const tfl = fakeTfl();
    const res = await handleStatus(deps(store, tfl).d);
    const b = await body(res);
    expect(res.status).toBe(200);
    expect(b).toMatchObject({ checkedAt: NOW, stale: false });
    expect(b.lines).toHaveLength(RAIL_REFERENCE.lines.length);
    expect(store.snapshot?.checkedAt).toBe(NOW);
  });

  it('fresh snapshot (< 15 s): one store read, no TfL call', async () => {
    const store = await seeded(NOW - 5_000);
    const tfl = fakeTfl();
    const res = await handleStatus(deps(store, tfl).d);
    expect(tfl.seen).toHaveLength(0);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=10');
  });

  it('15–60 s: serves the stored snapshot now and refreshes in the background', async () => {
    const store = await seeded(NOW - 30_000);
    const tfl = fakeTfl();
    const { d, background } = deps(store, tfl);
    const b = await body(await handleStatus(d));
    expect(b.checkedAt).toBe(NOW - 30_000);
    expect(background).toHaveLength(1);
    await Promise.all(background);
    expect(store.snapshot?.checkedAt).toBe(NOW);
  });

  it('only the lease winner refreshes: concurrent requests make one refresh', async () => {
    const store = await seeded(NOW - 30_000);
    const tfl = fakeTfl();
    const runs = Array.from({ length: 10 }, () => deps(store, tfl));
    await Promise.all(runs.map((r) => handleStatus(r.d)));
    expect(runs.flatMap((r) => r.background)).toHaveLength(1);
  });

  it('> 60 s: refreshes inline and returns the new data', async () => {
    const store = await seeded(NOW - 120_000);
    const b = await body(await handleStatus(deps(store, fakeTfl()).d));
    expect(b).toMatchObject({ checkedAt: NOW, stale: false });
  });

  it('TfL down: keeps and serves the last good snapshot, marked stale', async () => {
    const store = await seeded(NOW - 120_000);
    const b = await body(await handleStatus(deps(store, fakeTfl('down')).d));
    expect(b).toMatchObject({ checkedAt: NOW - 120_000, stale: true });
    expect(store.snapshot?.checkedAt).toBe(NOW - 120_000);
    // Back-off: requests right after a failure don't hit TfL again, and still say stale.
    const quiet = fakeTfl();
    const again = await body(await handleStatus(deps(store, quiet, NOW + 1_000).d));
    expect(again.stale).toBe(true);
    expect(quiet.seen).toHaveLength(0);
    // After the back-off, TfL is tried again; once it's back, data is live.
    const later = await body(await handleStatus(deps(store, fakeTfl(), NOW + LIVE.failureBackoffMs + 1).d));
    expect(later.stale).toBe(false);
  });

  it('an invalid 200 body is a failure, never an overwrite', async () => {
    const store = await seeded(NOW - 120_000);
    const b = await body(await handleStatus(deps(store, fakeTfl('invalid')).d));
    expect(b).toMatchObject({ checkedAt: NOW - 120_000, stale: true });
  });

  it('no snapshot and TfL down: 503, not cached', async () => {
    const res = await handleStatus(deps(new MemoryStore(), fakeTfl('down')).d);
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('arrivals calls failing: affected lines reuse a verdict < 2 min old, else CANT_VERIFY', async () => {
    const recent = await seeded(NOW - 90_000);
    const b = await body(await handleStatus(deps(recent, fakeTfl('arrivals-down')).d));
    const judged = b.lines.filter((l) => l.verdict !== 'CANT_VERIFY' || l.reason !== 'status-only');
    expect(judged.some((l) => l.checkedAt === NOW - 90_000)).toBe(true);

    const old = await seeded(NOW - LIVE.reuseVerdictMs - 60_000);
    const b2 = await body(await handleStatus(deps(old, fakeTfl('arrivals-down')).d));
    expect(b2.lines.every((l) => l.checkedAt === NOW)).toBe(true);
  });

  it('budget spent: no TfL call, stored data marked stale', async () => {
    const store = await seeded(NOW - 120_000);
    store.budget.set(Math.floor(NOW / 60_000), LIVE.budgetPerMinute);
    const tfl = fakeTfl();
    const b = await body(await handleStatus(deps(store, tfl).d));
    expect(tfl.seen).toHaveLength(0);
    expect(b.stale).toBe(true);
  });

  it('a refresh stays within the subrequest plan and never has more than 6 calls in flight', async () => {
    const tfl = fakeTfl();
    await handleStatus(deps(new MemoryStore(), tfl).d);
    expect(tfl.seen.length).toBeLessThanOrEqual(plannedCalls(RAIL_REFERENCE));
    expect(tfl.seen.length).toBeLessThanOrEqual(LIVE.maxCallsPerRefresh);
    expect(tfl.maxInFlight).toBeLessThanOrEqual(LIVE.concurrency);
  });

  it('the key is sent to TfL but never appears in the response or logs', async () => {
    const errors = vi.spyOn(console, 'error');
    const tfl = fakeTfl('down');
    const store = await seeded(NOW - 120_000);
    const text = await (await handleStatus(deps(store, tfl).d)).text();
    expect(tfl.seen.every((u) => u.includes(`app_key=${KEY}`))).toBe(true);
    expect(text).not.toContain(KEY);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(KEY);
    expect(errors).toHaveBeenCalled();
  });
});

describe('D1 unavailable', () => {
  beforeEach(() => {
    resetMemoForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('calls TfL directly and memoises per isolate for 15 s', async () => {
    const tfl = fakeTfl();
    await handleStatusWithoutStore(tfl.client, RAIL_REFERENCE, NOW);
    const calls = tfl.seen.length;
    const b = await body(await handleStatusWithoutStore(tfl.client, RAIL_REFERENCE, NOW + 5_000));
    expect(tfl.seen).toHaveLength(calls);
    expect(b.checkedAt).toBe(NOW);
  });
});

describe('snapshot from live fixtures', () => {
  it('judges every reference line; Waterloo & City is closed, Cable Car status-only', async () => {
    const s: Snapshot = await buildSnapshot(fakeTfl().client(), RAIL_REFERENCE, NOW, null);
    const byId = new Map(s.lines.map((l) => [l.lineId, l]));
    expect(byId.get('waterloo-city')).toMatchObject({ verdict: 'CLOSED', reason: 'planned-closure' });
    expect(byId.get('london-cable-car')).toMatchObject({ verdict: 'CANT_VERIFY', reason: 'status-only' });
    expect(byId.get('bakerloo')?.tflSays).toBe('Severe Delays, Part Suspended');
  });
});
