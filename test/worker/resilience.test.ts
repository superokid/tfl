/** Partial failures degrade what they touch and never take the response down. */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isBusRouteBody, isStatusBody, LINES_VERSION, type BusRouteBody, type Snapshot, type StatusBody } from '../../src/shared/api';
import { LIVE } from '../../src/shared/config';
import { BUSES, RAIL_REFERENCE, STATIONS } from '../../src/shared/reference/load';
import { handleBusRoute, MemoryJsonCache } from '../../src/worker/bus';
import { buildSnapshot } from '../../src/worker/refresh';
import { CallLimiter, handleStation, MemoryStationCache } from '../../src/worker/station';
import { handleStatus } from '../../src/worker/status';
import { D1Store, MemoryStore } from '../../src/worker/store';
import { createTflClient } from '../../src/worker/tfl/client';

const KEY = 'NOT-A-REAL-KEY-NOT-A-REAL-KEY';
const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8')).body;
const NOW = Date.parse('2026-11-08T12:12:00Z');

const tflFrom = (route: (path: string) => Response) => () =>
  createTflClient(KEY, (async (input: RequestInfo | URL) => route(new URL(String(input)).pathname)) as typeof fetch);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const railTfl = tflFrom((p) => (p.endsWith('/Status') ? reply(fixture('status-rail')) : reply([])));
const downTfl = tflFrom(() => reply({}, 503));

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('snapshot store failures', () => {
  const deps = (store: MemoryStore<Snapshot>, tfl = railTfl) => ({ store, tfl, reference: RAIL_REFERENCE, now: NOW, waitUntil: () => {} });

  it('saving a fresh snapshot fails: the fresh data is still served', async () => {
    const store = new MemoryStore<Snapshot>();
    store.write = () => Promise.reject(new Error('D1 write failed'));
    const res = await handleStatus(deps(store));
    expect(res.status).toBe(200);
    const b = (await res.json()) as StatusBody;
    expect(isStatusBody(b)).toBe(true);
    expect(b).toMatchObject({ checkedAt: NOW, stale: false });
  });

  it('TfL down and recording the failure fails too: the last good copy is still served', async () => {
    const store = new MemoryStore<Snapshot>();
    store.snapshot = await buildSnapshot(railTfl(), RAIL_REFERENCE, NOW - 120_000, null);
    store.markFailed = () => Promise.reject(new Error('D1 write failed'));
    const b = (await (await handleStatus(deps(store, downTfl))).json()) as StatusBody;
    expect(b).toMatchObject({ checkedAt: NOW - 120_000, stale: true });
  });

  it('a corrupt stored row reads as no snapshot, so it is refreshed', async () => {
    const stmt = { bind: () => stmt, first: async () => ({ body: '{not json', failed_at: null }) };
    const db = { prepare: () => stmt } as unknown as D1Database;
    expect(await new D1Store(db, 'lines', LINES_VERSION).read()).toEqual({ snapshot: null, failedAt: null });
  });
});

describe('on-demand endpoints', () => {
  const stationDeps = (tfl: () => ReturnType<typeof railTfl>, cache = new MemoryStationCache()) => ({
    id: '940GZZLUOXC',
    stations: STATIONS,
    buses: BUSES,
    reference: RAIL_REFERENCE,
    cache,
    limiter: new CallLimiter(LIVE.stationCallsPerMinute),
    tfl,
    now: NOW,
  });

  it('a station fetch that throws is a 503, not a crash', async () => {
    const res = await handleStation(
      stationDeps(() => {
        throw new Error('boom');
      }),
    );
    expect(res.status).toBe(503);
  });

  it('bus route: an unreadable status still shows the stops and live times', async () => {
    const tfl = tflFrom((p) => {
      if (p === '/Line/38/Status') return reply({ unexpected: true });
      if (p === '/Line/38/Arrivals') return reply(fixture('arr-bus-38'));
      if (p.startsWith('/Line/38/Route/Sequence/')) return reply(fixture(`seq-bus-38-${p.split('/').pop()}`));
      return reply({}, 404);
    });
    const res = await handleBusRoute('38', {
      buses: BUSES,
      cache: new MemoryJsonCache(),
      limiter: new CallLimiter(60),
      tfl,
      now: Date.parse('2026-11-08T13:35:00Z'),
    });
    expect(res.status).toBe(200);
    const b = (await res.json()) as BusRouteBody;
    expect(isBusRouteBody(b)).toBe(true);
    expect(b.statuses).toEqual([]);
    expect(b.timesLive).toBe(true);
    expect(b.directions.length).toBe(2);
  });
});

describe('TfL client', () => {
  it('an error response body is released, so it cannot hold one of the 6 connections', async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel: () => void (cancelled = true) });
    const tfl = createTflClient(KEY, (async () => new Response(body, { status: 500 })) as typeof fetch);
    await expect(tfl.getJson('/Line/victoria/Status')).rejects.toMatchObject({ kind: 'http' });
    expect(cancelled).toBe(true);
  });
});
