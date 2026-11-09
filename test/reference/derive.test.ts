import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  boundWord,
  cleanStationName,
  collectStations,
  directionFromTimetable,
  learnBoundDirections,
  pickCheckStations,
  scheduleWeekdays,
  serviceDayFrom,
} from '../../src/shared/reference/derive';

const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8')).body;

describe('pickCheckStations', () => {
  it('Northern: picks stations on every branch (shared section), spread apart', () => {
    const picks = pickCheckStations(fixture('seq-northern-outbound'));
    expect(picks).toHaveLength(2);
    const routes: string[][] = fixture('seq-northern-outbound').orderedLineRoutes.map((r: { naptanIds: string[] }) => r.naptanIds);
    for (const p of picks) expect(routes.every((r) => r.includes(p.stopId))).toBe(true);
    expect(picks[0]!.stopId).not.toBe(picks[1]!.stopId);
  });

  it('a 3-stop line (Liberty) still gets 2 check stations', () => {
    expect(pickCheckStations(fixture('seq-liberty-outbound'))).toHaveLength(2);
  });

  it('a malformed response gives no picks, never a crash', () => {
    expect(pickCheckStations({ orderedLineRoutes: 'nope' })).toEqual([]);
    expect(pickCheckStations(null)).toEqual([]);
  });
});

describe('scheduleWeekdays', () => {
  it.each([
    ['Monday - Thursday', [1, 2, 3, 4]],
    ['Friday', [5]],
    ['Saturday (also Good Friday)', [6]],
    ['Sunday', [0]],
    ['Saturdays and Public Holidays', [6]],
    ['Monday to Friday', [1, 2, 3, 4, 5]],
    ['Monday - Friday', [1, 2, 3, 4, 5]],
    ['Saturday - Sunday', [6, 0]],
    ['Bank Holiday', []],
  ])('%s → %j', (name, days) => {
    expect(scheduleWeekdays(name)).toEqual(days);
  });
});

describe('serviceDayFrom', () => {
  it('hourly median gaps, merged when equal, with first and last departure', () => {
    // 05:00–06:59 every 10 min, then 07:00–07:59 every 3.
    const deps = [...Array.from({ length: 12 }, (_, i) => 300 + i * 10), ...Array.from({ length: 20 }, (_, i) => 420 + i * 3)];
    expect(serviceDayFrom(deps)).toEqual({
      firstMin: 300,
      lastMin: 477,
      bands: [
        { fromMin: 300, toMin: 420, normalGapMin: 10 },
        { fromMin: 420, toMin: 480, normalGapMin: 3 },
      ],
    });
  });

  it('needs at least two departures', () => {
    expect(serviceDayFrom([300])).toBeNull();
  });
});

describe('directionFromTimetable (live fixtures)', () => {
  it('Victoria from Brixton: Friday Night Tube runs past midnight; Mon–Thu share one service day', () => {
    const d = directionFromTimetable(fixture('tt-victoria-brixton'), 'outbound')!;
    const fri = d.serviceDays[d.weekdays[5]]!;
    expect(fri.lastMin).toBeGreaterThan(24 * 60);
    expect(new Set([d.weekdays[1], d.weekdays[2], d.weekdays[3], d.weekdays[4]]).size).toBe(1);
    const midday = fri.bands.find((b) => b.fromMin <= 12 * 60 && 12 * 60 < b.toMin)!;
    expect(midday.normalGapMin).toBeGreaterThanOrEqual(1.5);
    expect(midday.normalGapMin).toBeLessThanOrEqual(5);
  });

  it('Northern at Euston merges both branch routes', () => {
    const d = directionFromTimetable(fixture('tt-northern-euston-outbound'), 'outbound')!;
    expect(d.weekdays.every((w) => w >= 0)).toBe(true);
  });

  it('a timetable missing a Mon–Fri schedule gives null, not "no service that day"', () => {
    // Piccadilly, 8 Nov 2026: TfL left out "Monday - Thursday", so the line read as closed all day Mon–Thu.
    const body = structuredClone(fixture('tt-victoria-brixton'));
    for (const r of body.timetable.routes) {
      r.schedules = r.schedules.filter((s: { name: string }) => s.name !== 'Monday - Thursday');
    }
    expect(directionFromTimetable(body, 'outbound')).toBeNull();
  });

  it('a missing Sunday schedule is real (Waterloo & City): that day stays -1', () => {
    const body = structuredClone(fixture('tt-victoria-brixton'));
    for (const r of body.timetable.routes) r.schedules = r.schedules.filter((s: { name: string }) => s.name !== 'Sunday');
    expect(directionFromTimetable(body, 'outbound')!.weekdays[0]).toBe(-1);
  });

  it('a disambiguation or empty body gives null', () => {
    expect(directionFromTimetable({ $type: 'Disambiguation' }, 'inbound')).toBeNull();
  });
});

describe('platform directions', () => {
  it('reads compass words', () => {
    expect(boundWord('Northbound - Platform 4')).toBe('northbound');
    expect(boundWord('Inner Rail - Platform 1')).toBe('inner rail');
    expect(boundWord('Platform 2')).toBeNull();
  });

  it('learns compass → direction from live arrivals (Oxford Circus)', () => {
    const map = learnBoundDirections(fixture('arr-multi-oxford-circus'));
    expect(Object.keys(map).length).toBeGreaterThan(0);
    for (const v of Object.values(map)) expect(['inbound', 'outbound']).toContain(v);
  });

  it('cleans station names', () => {
    expect(cleanStationName('Oxford Circus Underground Station')).toBe('Oxford Circus');
    expect(cleanStationName('Bond Street (Elizabeth line)')).toBe('Bond Street');
    expect(cleanStationName('Wimbledon Tram Stop')).toBe('Wimbledon');
  });
});

describe('collectStations', () => {
  const stop = (id: string, name: string, parent: string, at?: [number, number]) => ({
    id,
    name,
    topMostParentId: parent,
    ...(at ? { lat: at[0], lon: at[1] } : {}),
  });
  const seq = (lineId: string, stops: unknown[]) => ({ lineId, stopPointSequences: [{ stopPoint: stops }] });

  it('keeps coordinates; a hub sits at the middle of its stops, to 4 places', () => {
    const [stratford, bank] = collectStations([
      seq('central', [stop('940GZZLUSTD', 'Stratford Underground Station', 'HUBSRA', [51.54154, -0.00366])]),
      seq('elizabeth', [stop('910GSTFD', 'Stratford (London) Rail Station', 'HUBSRA', [51.541895, -0.003397])]),
      seq('central', [stop('940GZZLUBNK', 'Bank Underground Station', '940GZZLUBNK', [51.513356, -0.088899])]),
    ]).sort((a, b) => b.name.localeCompare(a.name));
    expect(stratford).toMatchObject({ id: 'HUBSRA', lat: 51.5417, lon: -0.0035, lines: ['central', 'elizabeth'] });
    expect(bank).toMatchObject({ id: '940GZZLUBNK', lat: 51.5134, lon: -0.0889 });
  });

  it('a stop with no usable coordinates is left out of the average; none at all gives none', () => {
    const [a, b] = collectStations([
      seq('dlr', [stop('A', 'Alpha DLR Station', 'HUBA', [51.5, 0.1]), { ...stop('A2', 'Alpha', 'HUBA'), lat: 'x', lon: 0 }]),
      seq('dlr', [stop('B', 'Beta DLR Station', 'B')]),
    ]);
    expect(a).toMatchObject({ id: 'HUBA', lat: 51.5, lon: 0.1 });
    expect(b!.id).toBe('B');
    expect(b).not.toHaveProperty('lat');
    expect(b).not.toHaveProperty('lon');
  });
});
