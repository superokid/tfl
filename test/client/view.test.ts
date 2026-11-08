import { describe, expect, it } from 'vitest';
import {
  checkCard,
  evidenceText,
  formatAge,
  formatDue,
  prettyStatus,
  rowNote,
  severityFromSays,
  searchByName,
  searchRoutes,
  sortLines,
  statusTone,
  tabOf,
  tabSummary,
} from '../../src/client/view';
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
