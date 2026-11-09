import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TflError } from '../../src/worker/tfl/client';
import { parseArrivals, parseStatuses } from '../../src/worker/tfl/parse';

const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8')).body;

describe('parseStatuses (live fixtures)', () => {
  it('reads every rail line, with several statuses on one line', () => {
    const map = parseStatuses(fixture('status-rail'));
    expect(map.size).toBe(21);
    expect(map.get('bakerloo')!.map((s) => s.description)).toEqual(['Severe Delays', 'Part Suspended']);
  });

  it('parses validity dates (UTC) and ignores isNow', () => {
    const wc = parseStatuses(fixture('status-rail')).get('waterloo-city')![0]!;
    expect(wc.description).toBe('Planned Closure');
    expect(wc.validityPeriods[0]).toEqual({
      from: Date.parse('2026-11-08T04:15:00Z'),
      to: Date.parse('2026-11-08T23:59:00Z'),
    });
  });

  it('reads affected stops with ?detail=true', () => {
    const partial = parseStatuses(fixture('status-rail-detail'))
      .get('bakerloo')!
      .find((s) => s.description === 'Part Suspended')!;
    expect(partial.affectedStopIds).toContain('940GZZLUQPS');
  });

  it("keeps TfL's passenger message", () => {
    const central = parseStatuses(fixture('status-rail')).get('central')![0]!;
    expect(central.reason).toContain('Minor delays');
  });

  it('a 200 with the wrong shape is a failure, not an empty result', () => {
    expect(() => parseStatuses({ message: 'oops' })).toThrow(TflError);
    expect(() => parseStatuses([])).toThrow(TflError);
  });
});

describe('parseArrivals (live fixtures)', () => {
  it('splits a multi-line call by line', () => {
    const map = parseArrivals(fixture('arr-multi-oxford-circus'), '940GZZLUOXC', {});
    expect([...map.keys()].sort()).toEqual(['bakerloo', 'central', 'victoria']);
  });

  it('fills a missing direction from another vehicle on the same platform', () => {
    const preds = parseArrivals(fixture('arr-bakerloo-queens-park'), '940GZZLUQPS', {}).get('bakerloo')!;
    expect(preds.every((p) => p.directionKey === 'inbound' || p.directionKey === 'outbound' || p.directionKey.startsWith('platform:'))).toBe(true);
    expect(preds.filter((p) => p.directionKey === 'inbound').length).toBeGreaterThan(1);
  });

  it('an empty direction ("") counts as missing (Mildmay at Homerton, live 9 Nov 2026: Clapham trains)', () => {
    const a = (id: string, direction: string) => ({
      id,
      vehicleId: id,
      lineId: 'mildmay',
      platformName: 'Platform 1',
      direction,
      destinationNaptanId: '910GCLPHMJ1',
      expectedArrival: '2026-11-09T08:50:00Z',
      timing: { read: '2026-11-09T08:46:00Z' },
    });
    const preds = parseArrivals([a('1', 'outbound'), a('2', '')], '910GHOMRTON', {}).get('mildmay')!;
    expect(preds.map((p) => p.directionKey)).toEqual(['outbound', 'outbound']);
  });

  it('reads destinations for the board, never "Check Front of Train"', () => {
    const preds = parseArrivals(fixture('arr-victoria-oxford-circus'), '940GZZLUOXC', {}).get('victoria')!;
    expect(preds.map((p) => p.destination)).toContain('Brixton');
    const qp = parseArrivals(fixture('arr-bakerloo-queens-park'), '940GZZLUQPS', {}).get('bakerloo')!;
    expect(qp.every((p) => p.destination !== 'Check Front of Train')).toBe(true);
  });

  it('marks trains terminating here, and unconfirmed (no destination) vehicles', () => {
    const preds = parseArrivals(fixture('arr-bakerloo-queens-park'), '940GZZLUQPS', {}).get('bakerloo')!;
    expect(preds.some((p) => p.terminatesHere)).toBe(true);
    expect(preds.some((p) => !p.confirmed)).toBe(true);
  });

  it('uses the learnt compass mapping when nothing else gives a direction', () => {
    const body = [{ lineId: 'x', vehicleId: '1', expectedArrival: '2026-11-08T12:00:00Z', platformName: 'Westbound - Platform 1', timing: { read: '2026-11-08T11:59:00Z' } }];
    const p = parseArrivals(body, 'stop', { x: { westbound: 'outbound' } }).get('x')![0]!;
    expect(p).toMatchObject({ directionKey: 'outbound', directionLabel: 'westbound', confirmed: false });
  });

  it('skips malformed records but rejects a non-array body', () => {
    expect(parseArrivals([null, { lineId: 'x' }], 'stop', {}).size).toBe(0);
    expect(() => parseArrivals({}, 'stop', {})).toThrow(TflError);
  });
});
