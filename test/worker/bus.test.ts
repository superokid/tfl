import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isBusRouteBody, isStationBody, type BusRouteBody, type BusSearchBody } from '../../src/shared/api';
import { LIVE } from '../../src/shared/config';
import { BUSES, RAIL_REFERENCE, STATIONS } from '../../src/shared/reference/load';
import { arrivalsByStop, handleBusRoute, handleBusSearch, MemoryJsonCache, normaliseQuery, routeStops } from '../../src/worker/bus';
import { CallLimiter, handleStation, isBusStopId, MemoryStationCache } from '../../src/worker/station';
import { createTflClient } from '../../src/worker/tfl/client';

const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8')).body;
const NOW = Date.parse('2026-11-08T13:35:00Z'); // when the bus 38 arrivals fixture was captured

function fakeTfl() {
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    if (url.pathname.startsWith('/StopPoint/Search/')) return new Response(JSON.stringify(fixture('search-bus-oxford-circus')));
    if (url.pathname.startsWith('/StopPoint/') && url.pathname.endsWith('/Arrivals')) return new Response(JSON.stringify(fixture('arr-bus-stop-oxford-circus')));
    if (url.pathname === '/Line/38/Status') return new Response(JSON.stringify(fixture('status-bus-38')));
    if (url.pathname === '/Line/38/Arrivals') return new Response(JSON.stringify(fixture('arr-bus-38')));
    if (url.pathname === '/Line/38/Route/Sequence/outbound') return new Response(JSON.stringify(fixture('seq-bus-38-outbound')));
    if (url.pathname === '/Line/38/Route/Sequence/inbound') return new Response(JSON.stringify(fixture('seq-bus-38-inbound')));
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { seen, client: () => createTflClient('NOT-A-REAL-KEY-NOT-A-REAL-KEY', fetchImpl) };
}

const deps = (tfl = fakeTfl(), cache = new MemoryJsonCache()) => ({
  buses: BUSES,
  cache,
  limiter: new CallLimiter(LIVE.stationCallsPerMinute),
  tfl: tfl.client,
  now: NOW,
});

describe('bus stops', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('accepts single stops, not stop areas or junk', () => {
    expect(isBusStopId('490000173RC')).toBe(true);
    expect(isBusStopId('490G00015204')).toBe(false);
    expect(isBusStopId('940GZZLUOXC')).toBe(false);
  });

  it('search returns single stops with "towards", cached per query', async () => {
    const tfl = fakeTfl();
    const cache = new MemoryJsonCache();
    const b = (await (await handleBusSearch('Oxford  Circus', deps(tfl, cache))).json()) as BusSearchBody;
    expect(b.stops.length).toBeGreaterThan(0);
    expect(b.stops.every((s) => isBusStopId(s.id))).toBe(true);
    expect(b.stops[0]!.towards).toBe('Marble Arch Or Great Portland Street');
    await handleBusSearch('oxford circus', deps(tfl, cache));
    expect(tfl.seen).toHaveLength(1);
  });

  it('short queries never call TfL', async () => {
    expect(normaliseQuery('ox')).toBeNull();
    const tfl = fakeTfl();
    await handleBusSearch('ox', deps(tfl));
    expect(tfl.seen).toHaveLength(0);
  });

  it('a bus stop shows its routes, in route order, named by TfL', async () => {
    const res = await handleStation({
      id: '490000173RC',
      stations: STATIONS,
      buses: BUSES,
      reference: RAIL_REFERENCE,
      cache: new MemoryStationCache(),
      limiter: new CallLimiter(60),
      tfl: fakeTfl().client,
      now: NOW - 60_000,
    });
    const b: unknown = await res.json();
    expect(isStationBody(b)).toBe(true);
    const body = b as { name: string; lines: { lineId: string }[] };
    expect(body.name).toMatch(/^Oxford Circus Station/);
    expect(body.name).not.toMatch(/\s{2}/);
    expect(body.lines.map((l) => l.lineId)).toEqual([...body.lines.map((l) => l.lineId)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })));
  });
});

describe('bus routes: status and next buses at every stop', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  const route = async (d: ReturnType<typeof deps>) => {
    const b: unknown = await (await handleBusRoute('38', d)).json();
    expect(isBusRouteBody(b)).toBe(true);
    return b as BusRouteBody;
  };

  it('both directions, stops in route order, next buses soonest first', async () => {
    const b = await route(deps());
    expect(b.statuses).toEqual(['Good Service']);
    expect(b.timesLive).toBe(true);
    expect(b.directions.map((d) => d.id)).toEqual(['outbound', 'inbound']);
    const out = b.directions[0]!;
    expect(out.stops).toHaveLength(44);
    expect(out.stops[0]!.name).toBe('Clapton Pond');
    expect(out.towards).toBe(out.stops.at(-1)!.name);
    const withTimes = b.directions.flatMap((d) => d.stops).filter((s) => s.arrivals.length > 0);
    expect(withTimes.length).toBeGreaterThan(20);
    for (const s of withTimes) {
      expect(s.arrivals.length).toBeLessThanOrEqual(3);
      expect([...s.arrivals].sort((a, b) => a - b)).toEqual(s.arrivals);
    }
  });

  it('call budget: 4 TfL calls cold, 0 within 30 s, 2 after (stop order cached a day)', async () => {
    const tfl = fakeTfl();
    const cache = new MemoryJsonCache();
    await route({ ...deps(tfl, cache) });
    expect(tfl.seen).toHaveLength(4);
    await route({ ...deps(tfl, cache), now: NOW + 10_000 });
    expect(tfl.seen).toHaveLength(4);
    await route({ ...deps(tfl, cache), now: NOW + 40_000 });
    expect(tfl.seen).toHaveLength(6);
    expect(tfl.seen.slice(4).sort()).toEqual(['/Line/38/Arrivals', '/Line/38/Status']);
  });

  it('many people on the same route at once share one fetch', async () => {
    const tfl = fakeTfl();
    const cache = new MemoryJsonCache();
    await Promise.all(Array.from({ length: 10 }, () => handleBusRoute('38', deps(tfl, cache))));
    expect(tfl.seen).toHaveLength(4);
  });

  it('unknown route: 404, no TfL call; limit reached: no TfL call', async () => {
    const tfl = fakeTfl();
    expect((await handleBusRoute('999X', deps(tfl))).status).toBe(404);
    const limited = { ...deps(tfl), limiter: new CallLimiter(1) };
    expect((await handleBusRoute('38', limited)).status).toBe(503);
    expect(tfl.seen).toHaveLength(0);
  });

  it('parses a sequence and arrivals defensively', () => {
    expect(routeStops(fixture('seq-bus-38-outbound'))[0]).toMatchObject({ name: 'Clapton Pond', letter: 'E' });
    expect(routeStops({ nope: 1 })).toEqual([]);
    expect(() => arrivalsByStop({}, NOW)).toThrow();
  });
});
