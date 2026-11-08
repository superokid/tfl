import { describe, expect, it } from 'vitest';
import {
  checkCard,
  distanceM,
  evidenceText,
  formatAge,
  formatDistance,
  formatDue,
  loadErrorText,
  prettyStatus,
  rowNote,
  rowReason,
  severityFromSays,
  searchByName,
  searchRoutes,
  sortLines,
  stationsNear,
  statusTone,
  stopDetail,
  tabOf,
  tabSummary,
} from '../../src/client/lib/view';
import type { DirectionEvidence } from '../../src/shared/rules/types';

const ev = (over: Partial<DirectionEvidence>): DirectionEvidence => ({
  stopId: 's',
  stationName: 'Euston',
  directionKey: 'outbound',
  directionLabel: 'southbound',
  normalGapMin: 3,
  normalGapIsFallback: false,
  thresholdMin: 8,
  observedGapMin: 14,
  gapKind: 'next',
  gapStartMin: 0,
  horizonMin: 20,
  usable: true,
  issue: null,
  ...over,
});

describe('status in plain words', () => {
  it('sentence case, joined like TfL', () => {
    expect(prettyStatus('Severe Delays, Part Suspended')).toBe('Severe delays · Part suspended');
    expect(prettyStatus('Good Service')).toBe('Good service');
    expect(prettyStatus('')).toBe('No status from TfL');
  });

  it('tones', () => {
    expect(statusTone('NORMAL')).toBe('good');
    expect(statusTone('MINOR')).toBe('minor');
    expect(statusTone('PARTIAL')).toBe('major');
    expect(statusTone('NONE')).toBe('closed');
    expect(statusTone(null)).toBe('unknown');
  });

  it('problems first, worst first, then alphabetical', () => {
    const l = (lineName: string, severity: 'NORMAL' | 'MINOR' | 'PARTIAL' | null) => ({ lineName, severity });
    const sorted = sortLines([l('Victoria', 'NORMAL'), l('Central', 'MINOR'), l('Bakerloo', 'PARTIAL'), l('Jubilee', 'NORMAL'), l('X', null)]);
    expect(sorted.map((x) => x.lineName)).toEqual(['Bakerloo', 'Central', 'X', 'Jubilee', 'Victoria']);
  });

  it('severity from TfL text: the worst wins', () => {
    expect(severityFromSays('Severe Delays, Part Suspended')).toBe('PARTIAL');
    expect(severityFromSays('Good Service')).toBe('NORMAL');
    expect(severityFromSays('Teleporting')).toBeNull();
  });

  it('tab summary', () => {
    expect(tabSummary([{ severity: 'NORMAL' }, { severity: 'NORMAL' }], 'Tube')).toBe('Good service on all Tube lines');
    expect(tabSummary([{ severity: 'NORMAL' }, { severity: 'MINOR' }], 'Tube')).toBe('1 line has problems');
    expect(tabSummary([{ severity: 'NORMAL' }], 'Elizabeth line')).toBe('Good service');
  });

  it('modes map to tabs; cable car sits with tram', () => {
    expect(tabOf('cable-car')).toBe('tram');
    expect(tabOf('tube')).toBe('tube');
  });
});

describe('live check in plain words', () => {
  it('rows only mention it when it adds something', () => {
    expect(rowNote('HIDDEN_DISRUPTION')?.tone).toBe('alert');
    expect(rowNote('MATCH')?.text).toBe('Live trains match');
    expect(rowNote('CANT_VERIFY')).toBeNull();
    expect(rowNote(undefined)).toBeNull();
  });

  it('line page explains why it could not check, without jargon', () => {
    const c = checkCard('CANT_VERIFY', 'fallback-gap', 'x');
    expect(c.text).toBe("Couldn't check with live trains");
    expect(c.detail).toMatch(/timetable/);
    expect(checkCard('CANT_VERIFY', 'mixed-evidence', 'Services at Euston…').detail).toBe('Services at Euston…');
  });
});

describe('context lines', () => {
  it("home rows give TfL's reason only when there is a problem", () => {
    expect(rowReason({ severity: 'MINOR', messages: ['Minor delays due to train cancellations.'] })).toBe('Minor delays due to train cancellations.');
    expect(rowReason({ severity: null, messages: ['Odd status.'] })).toBe('Odd status.');
    expect(rowReason({ severity: 'NORMAL', messages: ['Lifts out of order at Bank.'] })).toBeNull();
    expect(rowReason({ severity: 'PARTIAL', messages: [] })).toBeNull();
  });

  it('a bus stop is told apart by its flag letter and direction', () => {
    expect(stopDetail('RC', 'Marble Arch')).toBe('Stop RC · towards Marble Arch');
    expect(stopDetail(null, 'Marble Arch')).toBe('towards Marble Arch');
    expect(stopDetail('RC', null)).toBe('Stop RC');
    expect(stopDetail(undefined, undefined)).toBe('Bus stop');
  });
});

describe('times', () => {
  it.each([
    [-20_000, 'Due'],
    [25_000, 'Due'],
    [45_000, '1 min'],
    [150_000, '3 min'],
  ])('%i ms ahead → %s', (ms, text) => expect(formatDue(1_000_000 + ms, 1_000_000)).toBe(text));

  it.each([
    [4_000, '4s ago'],
    [61_000, '1 min ago'],
    [3 * 3_600_000, '3 h ago'],
  ])('age %i → %s', (ms, text) => expect(formatAge(ms)).toBe(text));
});

describe('evidence', () => {
  it('reads as a sentence', () => {
    expect(evidenceText(ev({}))).toBe('Southbound: next in 14 min (usually 3 min)');
    expect(evidenceText(ev({ gapKind: 'between', observedGapMin: 12, gapStartMin: 7, normalGapIsFallback: true }))).toBe(
      'Southbound: 12 min gap from 7 min (usually 3 min, estimated)',
    );
    expect(evidenceText(ev({ usable: false, issue: 'frozen', observedGapMin: null }))).toBe('Southbound: predictions not updating');
  });
});

describe('search', () => {
  const st = (name: string) => ({ name });
  const all = [st('Bank'), st('Canning Town'), st('Kings Cross St. Pancras'), st("Shepherd's Bush"), st('Elephant & Castle'), st('Bankside')];

  it('stations: prefix, then word start, then contains; forgiving punctuation', () => {
    expect(searchByName(all, 'ban').map((s) => s.name)).toEqual(['Bank', 'Bankside']);
    expect(searchByName(all, 'town').map((s) => s.name)).toEqual(['Canning Town']);
    expect(searchByName(all, 'shepherds').map((s) => s.name)).toEqual(["Shepherd's Bush"]);
    expect(searchByName(all, 'elephant and').map((s) => s.name)).toEqual(['Elephant & Castle']);
    expect(searchByName(all, '  ')).toEqual([]);
  });

  it('bus routes: exact number first, never for words', () => {
    const routes = ['3', '38', '388', 'N38', 'N3', 'SL1'].map((name) => ({ name }));
    expect(searchRoutes(routes, '38').map((r) => r.name)).toEqual(['38', '388']);
    expect(searchRoutes(routes, '3').map((r) => r.name)).toEqual(['3', '38', '388']);
    expect(searchRoutes(routes, 'n3').map((r) => r.name)).toEqual(['N3', 'N38']);
    expect(searchRoutes(routes, 'bank')).toEqual([]);
  });
});

describe('lines near me', () => {
  const at = { lat: 51.5, lon: 0 };
  /** A station `m` metres due north of `at`. */
  const st = (id: string, m: number, lines: string[]) => ({ id, name: id, lines, lat: 51.5 + m / 111_195, lon: 0 });
  const stations = [
    st('far', 3000, ['victoria']),
    st('b', 600, ['central', 'dlr']),
    st('a', 200, ['central']),
    st('c', 700, ['dlr']),
    { id: 'no-coords', name: 'no-coords', lines: ['central'] },
    st('d', 750, ['central']),
    st('e', 790, ['central']),
  ];
  const opts = { radiusM: 800, maxStations: 3, farM: 5000 };

  it('distance, flat-earth: fine across London', () => {
    expect(distanceM(at, { lat: 51.509, lon: 0 })).toBeCloseTo(1001, -1);
    expect(distanceM(at, { lat: 51.5, lon: 0.01 })).toBeCloseTo(692, -1);
  });

  it('the closest stations on the tab\'s lines within the radius, nearest first, capped', () => {
    expect(stationsNear(stations, at, new Set(['central', 'victoria']), opts)).toEqual([
      { id: 'a', name: 'a', lines: ['central'], distanceM: 200 },
      { id: 'b', name: 'b', lines: ['central'], distanceM: 600 },
      { id: 'd', name: 'd', lines: ['central'], distanceM: 750 },
    ]);
  });

  it('none near: the closest one still counts, up to farM; beyond it, none', () => {
    expect(stationsNear(stations, at, new Set(['victoria']), opts).map((s) => [s.id, s.distanceM])).toEqual([['far', 3000]]);
    expect(stationsNear(stations, at, new Set(['victoria']), { ...opts, farM: 2000 })).toEqual([]);
    expect(stationsNear(stations, at, new Set(['jubilee']), opts)).toEqual([]);
  });

  it.each([
    [40, '40 m'],
    [243, '240 m'],
    [995, '1 km'],
    [1260, '1.3 km'],
  ])('%i m → %s', (m, text) => expect(formatDistance(m)).toBe(text));
});

describe('loadErrorText', () => {
  it.each([
    ['offline', "You're offline"],
    ['timeout', 'Timed out'],
    ['network', "Can't reach the service"],
    ['invalid', 'Unexpected response'],
    [404, 'Not found'],
    [429, 'Too many requests, try again in a minute'],
    [503, "TfL isn't responding"],
    [500, 'Something went wrong (500)'],
  ] as const)('%s → %s', (f, text) => expect(loadErrorText(f)).toBe(text));

  it('never ends with a full stop, so it reads inside a sentence', () => {
    for (const f of ['offline', 'timeout', 'network', 'invalid', 404, 429, 503, 500] as const) expect(loadErrorText(f)).not.toMatch(/\.$/);
  });
});
