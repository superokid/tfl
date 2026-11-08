import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNearbyBody, type NearbyBody } from '../../src/shared/api';
import { busRows } from '../../src/shared/boards';
import { LIVE, NEARBY } from '../../src/shared/config';
import { BUSES, RAIL_REFERENCE, STATIONS } from '../../src/shared/reference/load';
import { MemoryJsonCache } from '../../src/worker/bus';
import { handleNearby, type NearbyDeps, parseNearbyStops, toCell } from '../../src/worker/nearby';
import { CallLimiter, handleStation, MemoryStationCache } from '../../src/worker/station';
import { createTflClient } from '../../src/worker/tfl/client';

const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8')).body;
const NOW = Date.parse('2026-11-08T13:35:00Z'); // when the Oxford Circus bus stop fixture was captured
const LAT = '51.51543';
const LON = '-0.14191';

function fakeTfl(opts: { down?: boolean; stopsDown?: boolean } = {}) {
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.pathname === '/StopPoint' ? `/StopPoint?lat=${url.searchParams.get('lat')}&lon=${url.searchParams.get('lon')}` : url.pathname);
    if (opts.down) return new Response('{}', { status: 503 });
    if (url.pathname === '/StopPoint') return new Response(JSON.stringify(fixture('nearby-oxford-circus')));
    if (opts.stopsDown) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify(fixture('arr-bus-stop-oxford-circus')));
  }) as typeof fetch;
  return { seen, client: () => createTflClient('NOT-A-REAL-KEY-NOT-A-REAL-KEY', fetchImpl) };
}

interface World {
  cache: MemoryJsonCache;
  stationCache: MemoryStationCache;
  limiter: CallLimiter;
}
const world = (): World => ({ cache: new MemoryJsonCache(), stationCache: new MemoryStationCache(), limiter: new CallLimiter(LIVE.stationCallsPerMinute) });

const deps = (w: World, tfl = fakeTfl(), now = NOW): NearbyDeps => ({
  stations: STATIONS,
  buses: BUSES,
  reference: RAIL_REFERENCE,
  ...w,
  tfl: tfl.client,
  now,
});

async function body(res: Response): Promise<NearbyBody> {
  expect(res.status).toBe(200);
  const b: unknown = await res.json();
  expect(isNearbyBody(b)).toBe(true);
  return b as NearbyBody;
}

describe('nearby: coordinates', () => {
  it('rounds to a ~100 m cell, so neighbours share one answer', () => {
    expect(toCell('51.51543', '-0.14191')).toEqual({ lat: 51.515, lon: -0.142 });
    expect(toCell('51.51521', '-0.14240')).toEqual({ lat: 51.515, lon: -0.142 });
  });

  it('rejects missing, junk and non-London coordinates', () => {
    expect(toCell(null, '-0.1')).toBeNull();
    expect(toCell('abc', '-0.1')).toBeNull();
    expect(toCell('', '')).toBeNull();
    expect(toCell('48.8566', '2.3522')).toBeNull(); // Paris
    expect(toCell('Infinity', '0')).toBeNull();
  });
});

describe('nearby: parsing TfL stops', () => {
  it('keeps served bus stops only, closest first, with letter and direction', () => {
    const stops = parseNearbyStops(fixture('nearby-oxford-circus'), 5);
    expect(stops).toHaveLength(5);
    expect(stops.map((s) => s.distanceM)).toEqual([...stops.map((s) => s.distanceM)].sort((a, b) => a - b));
    expect(stops.map((s) => s.id)).not.toContain('490000173JA'); // no routes stop there
    expect(stops[0]).toMatchObject({ id: '490000173RC', letter: 'RC', towards: 'Marble Arch Or Great Portland Street' });
  });

  it('survives junk', () => {
    expect(parseNearbyStops(null, 5)).toEqual([]);
    expect(parseNearbyStops({ stopPoints: [null, 1, { id: 'x' }] }, 5)).toEqual([]);
  });
});

describe('/api/nearby', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('outside London: 400, no TfL call', async () => {
    const tfl = fakeTfl();
    const res = await handleNearby('48.85', '2.35', deps(world(), tfl));
    expect(res.status).toBe(400);
    expect(tfl.seen).toHaveLength(0);
  });

  it('closest stops with next buses, soonest first; only the rounded cell reaches TfL', async () => {
    const tfl = fakeTfl();
    const b = await body(await handleNearby(LAT, LON, deps(world(), tfl)));
    expect(tfl.seen[0]).toBe('/StopPoint?lat=51.515&lon=-0.142');
    expect(b.stops).toHaveLength(NEARBY.maxStops);
    const first = b.stops[0]!;
    expect(first.live).toBe(true);
    expect(first.buses.length).toBeGreaterThan(0);
    expect(first.buses.map((r) => r.times[0])).toEqual([...first.buses.map((r) => r.times[0])].sort((x, y) => x! - y!));
    expect(b.stale).toBe(false);
  });

  it('budget: 1 + 5 TfL calls cold, 0 within 30 s, 5 after (stop list cached a day)', async () => {
    const w = world();
    const cold = fakeTfl();
    await handleNearby(LAT, LON, deps(w, cold));
    expect(cold.seen).toHaveLength(1 + NEARBY.maxStops);

    const warm = fakeTfl();
    await handleNearby('51.5152', '-0.1424', deps(w, warm, NOW + 20_000)); // a neighbour, same cell
    expect(warm.seen).toHaveLength(0);

    const later = fakeTfl();
    await handleNearby(LAT, LON, deps(w, later, NOW + 40_000));
    expect(later.seen).toHaveLength(NEARBY.maxStops);
    expect(later.seen.some((p) => p.startsWith('/StopPoint?'))).toBe(false);
  });

  it('shares the stop cache with /api/station: a stop someone just opened costs nothing', async () => {
    const w = world();
    await handleStation({ id: '490000173RC', stations: STATIONS, buses: BUSES, reference: RAIL_REFERENCE, cache: w.stationCache, limiter: w.limiter, tfl: fakeTfl().client, now: NOW });
    const tfl = fakeTfl();
    await handleNearby(LAT, LON, deps(w, tfl, NOW + 1_000));
    expect(tfl.seen).not.toContain('/StopPoint/490000173RC/Arrivals');
  });

  it('10 people at once: one fetch per stop', async () => {
    const w = world();
    await handleNearby(LAT, LON, deps(w)); // stop list cached
    const tfl = fakeTfl();
    await Promise.all(Array.from({ length: 10 }, () => handleNearby(LAT, LON, deps(w, tfl, NOW + 40_000))));
    expect(tfl.seen).toHaveLength(NEARBY.maxStops);
  });

  it('times down: stops still listed, marked not live and stale; last good times reused', async () => {
    const w = world();
    const none = await body(await handleNearby(LAT, LON, deps(w, fakeTfl({ stopsDown: true }))));
    expect(none.stops.every((s) => !s.live && s.buses.length === 0)).toBe(true);
    expect(none.stale).toBe(true);

    await handleNearby(LAT, LON, deps(w, fakeTfl(), NOW + 1_000));
    const old = await body(await handleNearby(LAT, LON, deps(w, fakeTfl({ stopsDown: true }), NOW + 60_000)));
    expect(old.stops[0]!.buses.length).toBeGreaterThan(0);
    expect(old.stale).toBe(true);
  });

  it('TfL down and no stop list yet: 503', async () => {
    const res = await handleNearby(LAT, LON, deps(world(), fakeTfl({ down: true })));
    expect(res.status).toBe(503);
  });

  it('limit reached: no TfL call, 503 rather than a burst', async () => {
    const w = world();
    w.limiter = new CallLimiter(0);
    const tfl = fakeTfl();
    const res = await handleNearby(LAT, LON, deps(w, tfl));
    expect(res.status).toBe(503);
    expect(tfl.seen).toHaveLength(0);
  });

  it('never logs coordinates', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await handleNearby(LAT, LON, deps(world(), fakeTfl({ down: true })));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/51\.51|0\.14/);
  });
});

describe('busRows', () => {
  it('one row per route and destination, soonest first, gone buses dropped', () => {
    const board = (dests: [string, number][]) => ({
      stopId: 's',
      name: 's',
      live: true,
      directions: [{ key: 'k', label: 'l', arrivals: dests.map(([d, at]) => ({ at, destination: d, terminates: false })) }],
    });
    const rows = busRows(
      [
        { lineId: '38', lineName: '38', board: board([['Victoria', NOW + 300_000], ['Victoria', NOW + 60_000], ['Victoria', NOW - 120_000]]) },
        { lineId: '12', lineName: '12', board: board([['Dulwich', NOW + 120_000]]) },
      ],
      NOW,
    );
    expect(rows.map((r) => [r.routeName, r.times.length])).toEqual([['38', 2], ['12', 1]]);
    expect(rows[0]!.times).toEqual([NOW + 60_000, NOW + 300_000]);
  });
});
