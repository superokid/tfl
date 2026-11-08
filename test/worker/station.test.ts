import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStationBody, type StationBody } from '../../src/shared/api';
import { LIVE } from '../../src/shared/config';
import { collectStations } from '../../src/shared/reference/derive';
import { BUSES, RAIL_REFERENCE, STATIONS } from '../../src/shared/reference/load';
import { CallLimiter, handleStation, MemoryStationCache, type StationDeps } from '../../src/worker/station';
import { createTflClient } from '../../src/worker/tfl/client';

const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8')).body;
const NOW = Date.parse('2026-11-08T12:12:00Z');

function fakeTfl(down = false) {
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    if (down) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify(fixture('arr-multi-oxford-circus')));
  }) as typeof fetch;
  return { seen, client: () => createTflClient('NOT-A-REAL-KEY-NOT-A-REAL-KEY', fetchImpl) };
}

function deps(id: string, tfl = fakeTfl(), cache = new MemoryStationCache(), limiter = new CallLimiter(LIVE.stationCallsPerMinute), now = NOW): StationDeps {
  return { id, stations: STATIONS, buses: BUSES, reference: RAIL_REFERENCE, cache, limiter, tfl: tfl.client, now };
}

async function body(res: Response): Promise<StationBody> {
  const b: unknown = await res.json();
  expect(isStationBody(b)).toBe(true);
  return b as StationBody;
}

describe('station index', () => {
  it('covers every rail line; hubs merge their stop ids', () => {
    expect(STATIONS.stations.length).toBeGreaterThan(300);
    const stratford = STATIONS.stations.find((s) => s.id === 'HUBSRA')!;
    expect(stratford.stopIds.length).toBeGreaterThanOrEqual(2);
    expect(stratford.lines).toEqual(expect.arrayContaining(['central', 'elizabeth', 'jubilee']));
    expect(new Set(STATIONS.stations.map((s) => s.id)).size).toBe(STATIONS.stations.length);
  });

  it('collectStations cleans names and keeps the line', () => {
    const [first] = collectStations([fixture('seq-northern-outbound')]);
    expect(first!.name).not.toMatch(/Station$/);
    expect(first!.lines).toEqual(['northern']);
  });
});

describe('/api/station/:id', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('unknown station: 404, no TfL call', async () => {
    const tfl = fakeTfl();
    const res = await handleStation(deps('NOPE', tfl));
    expect(res.status).toBe(404);
    expect(tfl.seen).toHaveLength(0);
  });

  it('returns live boards per line, one call per stop id', async () => {
    const tfl = fakeTfl();
    const b = await body(await handleStation(deps('940GZZLUOXC', tfl)));
    expect(tfl.seen).toEqual(['/StopPoint/940GZZLUOXC/Arrivals']);
    expect(b.lines.map((l) => l.lineId).sort()).toEqual(['bakerloo', 'central', 'victoria']);
    expect(b.lines.find((l) => l.lineId === 'victoria')!.board.live).toBe(true);
  });

  it('repeat within 15 s: served from cache, no TfL call', async () => {
    const cache = new MemoryStationCache();
    await handleStation(deps('940GZZLUOXC', fakeTfl(), cache));
    const tfl = fakeTfl();
    await handleStation(deps('940GZZLUOXC', tfl, cache, undefined, NOW + 5_000));
    expect(tfl.seen).toHaveLength(0);
  });

  it('TfL down: last good copy, marked stale; nothing cached → 503', async () => {
    const cache = new MemoryStationCache();
    await handleStation(deps('940GZZLUOXC', fakeTfl(), cache));
    const b = await body(await handleStation(deps('940GZZLUOXC', fakeTfl(true), cache, undefined, NOW + 60_000)));
    expect(b).toMatchObject({ stale: true, checkedAt: NOW });
    const res = await handleStation(deps('940GZZLUOXC', fakeTfl(true)));
    expect(res.status).toBe(503);
  });

  it('per-instance limit reached: no TfL call (and no D1 write to count it)', async () => {
    const limiter = new CallLimiter(1);
    expect(limiter.tryTake(NOW, 1)).toBe(true);
    const tfl = fakeTfl();
    const res = await handleStation(deps('940GZZLUOXC', tfl, new MemoryStationCache(), limiter));
    expect(tfl.seen).toHaveLength(0);
    expect(res.status).toBe(503);
  });

  it('concurrent requests for one station share a single TfL fetch (no stampede)', async () => {
    const tfl = fakeTfl();
    const cache = new MemoryStationCache();
    const limiter = new CallLimiter(LIVE.stationCallsPerMinute);
    const res = await Promise.all(Array.from({ length: 20 }, () => handleStation(deps('940GZZLUOXC', tfl, cache, limiter))));
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(tfl.seen).toHaveLength(1);
  });

  it('the limiter frees up after a minute', () => {
    const limiter = new CallLimiter(2);
    expect(limiter.tryTake(NOW, 2)).toBe(true);
    expect(limiter.tryTake(NOW + 59_000, 1)).toBe(false);
    expect(limiter.tryTake(NOW + 60_000, 1)).toBe(true);
  });
});
