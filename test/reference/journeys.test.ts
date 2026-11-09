import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { directionFromDepartures, journeyPage, journeyTargets, sampleDays } from '../../src/shared/reference/journeys';

const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8')).body;

const leg = (time: string, over: Record<string, unknown> = {}) => ({
  departureTime: time,
  mode: { id: 'elizabeth-line' },
  departurePoint: { naptanId: '910GEALINGB' },
  routeOptions: [{ lineIdentifier: { id: 'elizabeth' } }],
  ...over,
});
const page = (legs: unknown[][], later: unknown = { date: '20261117', time: '2359' }) => ({
  journeys: legs.map((l) => ({ legs: l })),
  searchCriteria: { timeAdjustments: { later } },
});

describe('journeyPage: one journey planner response (live shape, 9 Nov 2026)', () => {
  it('Ealing Broadway → Hayes, Tuesday 12:00: three direct Elizabeth line departures and the next page', () => {
    const p = journeyPage(fixture('jp-elizabeth-ealing-hayes'), 'elizabeth', '910GEALINGB', '20261117');
    expect(p.departures).toEqual([12 * 60 + 4, 12 * 60 + 11, 12 * 60 + 14]);
    expect(p.next).toEqual({ date: '20261117', time: '1215' });
  });

  it('counts only direct journeys on this line from this stop', () => {
    const p = journeyPage(
      page([
        [leg('2026-11-17T12:04:00')],
        [{ ...leg('2026-11-17T12:05:00'), mode: { id: 'walking' }, routeOptions: [] }],
        [leg('2026-11-17T12:06:00', { routeOptions: [{ lineIdentifier: { id: 'great-western-railway' } }] })],
        [leg('2026-11-17T12:07:00'), leg('2026-11-17T12:20:00')],
        [leg('2026-11-17T12:08:00', { departurePoint: { naptanId: '910GWEALING' } })],
      ]),
      'elizabeth',
      '910GEALINGB',
      '20261117',
    );
    expect(p.departures).toEqual([12 * 60 + 4]);
  });

  it('after midnight counts on from the sampled day (hour ≥ 24), like TfL timetables', () => {
    const p = journeyPage(page([[leg('2026-11-18T00:31:00')]], { date: '20261118', time: '0032' }), 'elizabeth', '910GEALINGB', '20261117');
    expect(p.departures).toEqual([24 * 60 + 31]);
    expect(p.next).toEqual({ date: '20261118', time: '0032' });
  });

  it('a malformed body gives nothing, never a crash', () => {
    expect(journeyPage(null, 'elizabeth', '910GEALINGB', '20261117')).toEqual({ departures: [], next: null });
    expect(journeyPage({ journeys: 'x' }, 'elizabeth', '910GEALINGB', '20261117').departures).toEqual([]);
  });
});

describe('journeyTargets: where to plan to, so every train from the stop is seen', () => {
  const seq = (...routes: string[][]) => ({ orderedLineRoutes: routes.map((naptanIds) => ({ naptanIds })) });

  it("each route's next station, the furthest station all routes share, and each route's end (trains that skip stops)", () => {
    // Elizabeth westbound: 4 trains an hour skip West Ealing, but all reach Hayes & Harlington.
    const s = seq(['PAD', 'EAL', 'WEA', 'HAN', 'STH', 'HAY', 'HAP', 'HT4'], ['PAD', 'EAL', 'WEA', 'HAN', 'STH', 'HAY', 'WDR', 'RDG']);
    expect(journeyTargets(s, 'EAL')).toEqual(['WEA', 'HAY', 'HT4', 'RDG']);
    // Eastbound most trains skip Acton Main Line, then split: only the ends see them (live, 9 Nov 2026).
    const east = seq(['HAY', 'EAL', 'ACT', 'PADTON'], ['HAY', 'EAL', 'ACT', 'PADTLL', 'LIVSTLL', 'ABWD']);
    expect(journeyTargets(east, 'EAL')).toEqual(['ACT', 'PADTON', 'ABWD']);
  });

  it('branches right after the stop: each branch\'s next station', () => {
    expect(journeyTargets(seq(['A', 'B', 'C'], ['A', 'B', 'D']), 'B')).toEqual(['C', 'D']);
  });

  it('one route: the next station and the end of the line', () => {
    expect(journeyTargets(seq(['A', 'B', 'C', 'D']), 'B')).toEqual(['C', 'D']);
    expect(journeyTargets(seq(['A', 'B', 'C']), 'B')).toEqual(['C']);
  });

  it('nothing departs from the end of the line in this direction', () => {
    expect(journeyTargets(seq(['A', 'B', 'C']), 'C')).toEqual([]);
    expect(journeyTargets(null, 'C')).toEqual([]);
  });
});

describe('sampleDays', () => {
  it('Mon–Thu, Friday, Saturday, Sunday, each at least 2 days ahead, with the same day a week later as a fallback', () => {
    expect(sampleDays('2026-11-09')).toEqual([
      { weekdays: [1, 2, 3, 4], dates: ['20261117', '20261124'] },
      { weekdays: [5], dates: ['20261113', '20261120'] },
      { weekdays: [6], dates: ['20261114', '20261121'] },
      { weekdays: [0], dates: ['20261115', '20261122'] },
    ]);
  });
});

describe('directionFromDepartures', () => {
  const every = (gap: number, from = 360, to = 1440) => Array.from({ length: Math.floor((to - from) / gap) + 1 }, (_, i) => from + i * gap);

  it('one service day per sampled day, mapped to its weekdays; identical days are stored once', () => {
    const d = directionFromDepartures(
      [
        { weekdays: [1, 2, 3, 4], departures: every(10) },
        { weekdays: [5], departures: every(10) },
        { weekdays: [6], departures: every(15) },
        { weekdays: [0], departures: every(15, 480) },
      ],
      'outbound',
    )!;
    expect(d.serviceDays).toHaveLength(3);
    expect(d.weekdays).toEqual([2, 0, 0, 0, 0, 0, 1]);
    expect(d.serviceDays[0]!.bands[0]).toMatchObject({ normalGapMin: 10, longestGapMin: 10 });
  });

  it('a sampled day with (almost) no trains gives no reference: "can\'t verify" beats a false "closed"', () => {
    const groups = [
      { weekdays: [1, 2, 3, 4] as const, departures: every(10) },
      { weekdays: [5] as const, departures: every(10) },
      { weekdays: [6] as const, departures: [600, 610] }, // engineering works: replacement buses
      { weekdays: [0] as const, departures: every(15) },
    ];
    expect(directionFromDepartures(groups.map((g) => ({ ...g, weekdays: [...g.weekdays] })), 'outbound')).toBeNull();
  });
});
