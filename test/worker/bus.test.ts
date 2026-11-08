import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isBusRouteBody, isStationBody, type BusSearchBody } from '../../src/shared/api';
import { LIVE } from '../../src/shared/config';
import { BUSES, RAIL_REFERENCE, STATIONS } from '../../src/shared/reference/load';
import { handleBusRoute, handleBusSearch, MemoryJsonCache, normaliseQuery } from '../../src/worker/bus';
import { CallLimiter, handleStation, isBusStopId, MemoryStationCache } from '../../src/worker/station';
import { createTflClient } from '../../src/worker/tfl/client';

const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8')).body;
const NOW = Date.parse('2026-11-08T13:30:00Z');

function fakeTfl() {
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    if (url.pathname.startsWith('/StopPoint/Search/')) return new Response(JSON.stringify(fixture('search-bus-oxford-circus')));
    if (url.pathname.endsWith('/Arrivals')) return new Response(JSON.stringify(fixture('arr-bus-stop-oxford-circus')));
    if (url.pathname === '/Line/38/Status') return new Response(JSON.stringify(fixture('status-bus-38')));
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

describe('bus routes', () => {
  it('status on demand; unknown route 404 without a TfL call', async () => {
    const tfl = fakeTfl();
    const ok: unknown = await (await handleBusRoute('38', deps(tfl))).json();
    expect(isBusRouteBody(ok)).toBe(true);
    expect((ok as { statuses: string[] }).statuses).toEqual(['Good Service']);
    const res = await handleBusRoute('999X', deps(tfl));
    expect(res.status).toBe(404);
    expect(tfl.seen).toEqual(['/Line/38/Status']);
  });
});
