import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isLineBody,
  isLinesBody,
  isStatusBody,
  isTabChecksBody,
  LINES_VERSION,
  type LinesBody,
  type LinesSnapshot,
  type Snapshot,
  type StatusBody,
  type TabChecksBody,
} from '../../src/shared/api';
import { MemoryJsonCache } from '../../src/worker/bus';
import { handleLine } from '../../src/worker/line';
import { CallLimiter } from '../../src/worker/station';
import { LIVE } from '../../src/shared/config';
import { RAIL_REFERENCE } from '../../src/shared/reference/load';
import { buildSnapshot } from '../../src/worker/refresh';
import {
  handleLines,
  handleLinesWithoutStore,
  handleStatus,
  handleStatusWithoutStore,
  handleTabChecks,
  handleTabChecksWithoutStore,
  plannedCalls,
  resetMemoForTests,
  sharedLineStatuses,
  tabReference,
  type StatusDeps,
} from '../../src/worker/status';
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
  let statusPending = 0;
  let arrivalsDuringStatus = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const isStatus = path.endsWith('/Status');
    seen.push(url.toString());
    if (path.includes('/Arrivals/') && statusPending > 0) arrivalsDuringStatus++;
    if (isStatus) statusPending++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    if (isStatus) statusPending--;
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
    /** Arrivals calls sent while a status call was still waiting for TfL. */
    get arrivalsDuringStatus() {
      return arrivalsDuringStatus;
    },
    client: () => createTflClient(KEY, fetchImpl),
  };
}

function deps(store: MemoryStore<Snapshot>, tfl: ReturnType<typeof fakeTfl>, now = NOW) {
  const background: Promise<unknown>[] = [];
  const d: StatusDeps = { store, tfl: tfl.client, reference: RAIL_REFERENCE, now, waitUntil: (p) => background.push(p) };
  return { d, background };
}

async function body(res: Response): Promise<StatusBody> {
  const b: unknown = await res.json();
  expect(isStatusBody(b)).toBe(true);
  return b as StatusBody;
}

async function seeded(at: number): Promise<MemoryStore<Snapshot>> {
  const store = new MemoryStore<Snapshot>();
  store.snapshot = await buildSnapshot(fakeTfl().client(), RAIL_REFERENCE, at, null);
  return store;
}

describe('/api/status data layer (ADR-006)', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('first request with no snapshot refreshes inline and stores it', async () => {
    const store = new MemoryStore<Snapshot>();
    const tfl = fakeTfl();
    const res = await handleStatus(deps(store, tfl).d);
    const b = await body(res);
    expect(res.status).toBe(200);
    expect(b).toMatchObject({ checkedAt: NOW, stale: false });
    expect(b.lines).toHaveLength(RAIL_REFERENCE.lines.length);
    expect(store.snapshot?.checkedAt).toBe(NOW);
  });

  it('a snapshot stored by an older deploy (other shape) is ignored and refreshed', async () => {
    const store = await seeded(NOW - 5_000);
    store.snapshot = { ...store.snapshot!, version: 1 };
    const b = await body(await handleStatus(deps(store, fakeTfl()).d));
    expect(b.checkedAt).toBe(NOW);
  });

  it('fresh snapshot (< 15 s): one store read, no TfL call', async () => {
    const store = await seeded(NOW - 5_000);
    const tfl = fakeTfl();
    const res = await handleStatus(deps(store, tfl).d);
    expect(tfl.seen).toHaveLength(0);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=25');
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
    const res = await handleStatus(deps(new MemoryStore<Snapshot>(), fakeTfl('down')).d);
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

  it('free-tier footprint: heavy traffic for 10 min → ≤ 1 refresh per 30 s, 2 D1 writes each', async () => {
    const store = new MemoryStore<Snapshot>();
    let refreshes = 0;
    // 600 requests, one per second, from many visitors.
    for (let t = 0; t < 600; t++) {
      const tfl = fakeTfl();
      const { d, background } = deps(store, tfl, NOW + t * 1000);
      await handleStatus(d);
      await Promise.all(background);
      if (tfl.seen.length > 0) refreshes++;
    }
    expect(refreshes).toBeLessThanOrEqual(600 / 30 + 1);
    expect(store.writes).toBeLessThanOrEqual(2 * refreshes);
  });

  it('a refresh stays within the subrequest plan and never has more than 6 calls in flight', async () => {
    const tfl = fakeTfl();
    await handleStatus(deps(new MemoryStore<Snapshot>(), tfl).d);
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
  it('judges every reference line; Waterloo & City is closed (no Sunday service), Cable Car status-only', async () => {
    const s: Snapshot = await buildSnapshot(fakeTfl().client(), RAIL_REFERENCE, NOW, null);
    const byId = new Map(s.lines.map((l) => [l.lineId, l]));
    expect(byId.get('waterloo-city')).toMatchObject({
      verdict: 'CLOSED',
      reason: 'outside-hours',
      offHours: true,
      opensAt: Date.UTC(2026, 10, 9, 6, 0), // Monday's first train at Waterloo
    });
    expect(byId.get('london-cable-car')).toMatchObject({ verdict: 'CANT_VERIFY', reason: 'status-only' });
    expect(byId.get('bakerloo')?.tflSays).toBe('Severe Delays, Part Suspended');
    expect(byId.get('bakerloo')?.messages).toHaveLength(1);
    expect(byId.get('bakerloo')?.messages[0]).toMatch(/^No service between Queen's Park/);
    expect(byId.get('victoria')?.boards).toHaveLength(2);
  });
});

describe('fetch only what the screen needs (ADR-011)', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('home screen: statuses only, at most 2 TfL calls, no arrivals', async () => {
    const tfl = fakeTfl();
    const store = new MemoryStore<LinesSnapshot>(LINES_VERSION);
    const res = await handleLines({ store, tfl: tfl.client, reference: RAIL_REFERENCE, now: NOW, waitUntil: () => {} });
    const b: unknown = await res.json();
    expect(isLinesBody(b)).toBe(true);
    expect(tfl.seen.length).toBeLessThanOrEqual(2);
    expect(tfl.seen.some((u) => u.includes('/Arrivals'))).toBe(false);
    const lines = (b as LinesBody).lines;
    expect(lines.find((l) => l.lineId === 'bakerloo')).toMatchObject({ severity: 'PARTIAL', tflSays: 'Severe Delays, Part Suspended' });
    expect(lines.find((l) => l.lineId === 'victoria')?.severity).toBe('NORMAL');
    expect(lines.find((l) => l.lineId === 'london-cable-car')?.checkable).toBe(false);
    // TfL's raw statuses are kept for the line screen, but never sent to the browser.
    expect(store.snapshot?.statuses.bakerloo?.length).toBeGreaterThan(0);
    expect(b).not.toHaveProperty('statuses');
    resetMemoForTests();
    expect(await (await handleLinesWithoutStore(fakeTfl().client, RAIL_REFERENCE, NOW)).json()).not.toHaveProperty('statuses');
  });

  it("line screen's statuses: the home screen's snapshot, refreshed the same way", async () => {
    const store = new MemoryStore<LinesSnapshot>(LINES_VERSION);
    const tfl = fakeTfl();
    const d = { store, tfl: tfl.client, reference: RAIL_REFERENCE, now: NOW, waitUntil: () => {} };
    const first = await sharedLineStatuses(d);
    expect(first?.checkedAt).toBe(NOW);
    expect(first?.statuses.victoria).toBeDefined();
    const calls = tfl.seen.length;
    expect(calls).toBeGreaterThan(0);
    expect((await sharedLineStatuses({ ...d, now: NOW + 5_000 }))?.checkedAt).toBe(NOW);
    expect(tfl.seen).toHaveLength(calls);
    expect(await sharedLineStatuses({ ...d, store: new MemoryStore<LinesSnapshot>(LINES_VERSION), tfl: fakeTfl('down').client })).toBeNull();
  });

  it('home screen: no verdicts in the statuses response (the open tab is checked separately)', async () => {
    const store = new MemoryStore<LinesSnapshot>(LINES_VERSION);
    const b = await (await handleLines({ store, tfl: fakeTfl().client, reference: RAIL_REFERENCE, now: NOW, waitUntil: () => {} })).json();
    expect(b).not.toHaveProperty('checks');
  });

  it('line screen: one line, its own stops only, cached and shared', async () => {
    const tfl = fakeTfl();
    const cache = new MemoryJsonCache();
    const limiter = new CallLimiter(60);
    const d = { lineId: 'victoria', reference: RAIL_REFERENCE, cache, limiter, sharedStatuses: async () => null, tfl: tfl.client, now: NOW, waitUntil: () => {} };
    const results = await Promise.all(Array.from({ length: 5 }, () => handleLine(d)));
    const b: unknown = await results[0]!.json();
    expect(isLineBody(b)).toBe(true);
    expect(tfl.seen.length).toBeLessThanOrEqual(1 + 2 + 1);
    expect(tfl.seen.filter((u) => u.includes('/Arrivals'))).toHaveLength(2);
    await handleLine({ ...d, now: NOW + 5_000 });
    expect(tfl.seen.filter((u) => u.includes('/Arrivals'))).toHaveLength(2);
    expect((await handleLine({ ...d, lineId: 'nope' })).status).toBe(404);
  });

  it('line screen and check-all: arrivals calls go out with the status call, not after it', async () => {
    const line = fakeTfl();
    const d = { lineId: 'victoria', reference: RAIL_REFERENCE, cache: new MemoryJsonCache(), limiter: new CallLimiter(60), sharedStatuses: async () => null, tfl: line.client, now: NOW, waitUntil: () => {} };
    await handleLine(d);
    // No shared statuses: the status call is sent after that lookup, still alongside both arrivals calls.
    expect(line.maxInFlight).toBe(3);

    const all = fakeTfl();
    await handleStatus(deps(new MemoryStore<Snapshot>(), all).d);
    expect(all.arrivalsDuringStatus).toBe(LIVE.concurrency - 1);
    expect(all.seen.length).toBeLessThanOrEqual(LIVE.maxCallsPerRefresh);
  });
});

describe('home tab checks: only the open tab\'s lines, shared by everyone (ADR-017)', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => {
    vi.restoreAllMocks();
    resetMemoForTests();
  });

  const tabDeps = (store: MemoryStore<Snapshot>, tfl: ReturnType<typeof fakeTfl>, tab: TabChecksBody['tab'], now = NOW) => ({
    ...deps(store, tfl, now).d,
    tab,
  });
  const tabLines = (tab: TabChecksBody['tab']) => tabReference(RAIL_REFERENCE, tab).lines;
  const tabStops = (tab: TabChecksBody['tab']) =>
    new Set(tabLines(tab).filter((l) => !l.statusOnly).flatMap((l) => l.stations.map((s) => s.stopId)));

  it('Tube tab: verdicts for Tube lines only, arrivals at their check stops only, within the call budget', async () => {
    const tfl = fakeTfl();
    const res = await handleTabChecks(tabDeps(new MemoryStore<Snapshot>(), tfl, 'tube'));
    const b: unknown = await res.json();
    expect(isTabChecksBody(b)).toBe(true);
    const body = b as TabChecksBody;
    expect(body.tab).toBe('tube');
    expect(Object.keys(body.lines).sort()).toEqual(tabLines('tube').map((l) => l.lineId).sort());
    const arrivals = tfl.seen.filter((u) => u.includes('/Arrivals'));
    expect(arrivals).toHaveLength(tabStops('tube').size);
    expect(arrivals.every((u) => [...tabStops('tube')].some((id) => u.includes(id)))).toBe(true);
    expect(tfl.seen.length).toBeLessThanOrEqual(LIVE.maxCallsPerRefresh);
    // Verdicts only: no boards or evidence, so the response stays small.
    expect(body.lines.victoria).toEqual({ verdict: expect.any(String), reason: expect.anything(), summary: expect.any(String) });
  });

  it('Tram tab: the tram is checked, the cable car (no predictions) costs no arrivals call', async () => {
    const tfl = fakeTfl();
    const body = (await (await handleTabChecks(tabDeps(new MemoryStore<Snapshot>(), tfl, 'tram'))).json()) as TabChecksBody;
    expect(Object.keys(body.lines).sort()).toEqual(['london-cable-car', 'tram']);
    expect(body.lines['london-cable-car']?.reason).toBe('status-only');
    expect(tfl.seen.filter((u) => u.includes('/Arrivals'))).toHaveLength(tabStops('tram').size);
  });

  it('one refresh per tab, shared: a second viewer within 30 s costs no TfL call', async () => {
    const store = new MemoryStore<Snapshot>();
    const tfl = fakeTfl();
    await handleTabChecks(tabDeps(store, tfl, 'tube'));
    const calls = tfl.seen.length;
    await Promise.all(Array.from({ length: 10 }, () => handleTabChecks(tabDeps(store, tfl, 'tube', NOW + 5_000))));
    expect(tfl.seen).toHaveLength(calls);
  });

  it('TfL down with nothing stored → 503, never an empty "all fine"', async () => {
    const res = await handleTabChecks(tabDeps(new MemoryStore<Snapshot>(), fakeTfl('down'), 'tube'));
    expect(res.status).toBe(503);
  });

  it('D1 unavailable: calls TfL directly for that tab, memoised briefly', async () => {
    const tfl = fakeTfl();
    await handleTabChecksWithoutStore(tfl.client, RAIL_REFERENCE, 'dlr', NOW);
    const calls = tfl.seen.length;
    const b: unknown = await (await handleTabChecksWithoutStore(tfl.client, RAIL_REFERENCE, 'dlr', NOW + 5_000)).json();
    expect(isTabChecksBody(b)).toBe(true);
    expect(tfl.seen).toHaveLength(calls);
    // Another tab isn't served from the DLR's memo.
    const tram = (await (await handleTabChecksWithoutStore(tfl.client, RAIL_REFERENCE, 'tram', NOW + 5_000)).json()) as TabChecksBody;
    expect(tram.tab).toBe('tram');
  });

  it('every tab fits the per-refresh call budget', () => {
    for (const tab of ['tube', 'elizabeth-line', 'overground', 'dlr', 'tram'] as const) {
      expect(tabStops(tab).size + 1, tab).toBeLessThanOrEqual(LIVE.maxCallsPerRefresh);
    }
  });
});
