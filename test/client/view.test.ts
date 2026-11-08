import { describe, expect, it } from 'vitest';
import { badgeLabel, evidenceText, formatAge, formatDue, groupLines, headline } from '../../src/client/view';
import type { DirectionEvidence, LineVerdict, VerdictKind } from '../../src/shared/rules/types';

const line = (lineName: string, verdict: VerdictKind): LineVerdict => ({
  lineId: lineName.toLowerCase(),
  lineName,
  mode: 'tube',
  verdict,
  reason: null,
  tflSays: 'Good Service',
  summary: '',
  evidence: [],
  checkedAt: 0,
});

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

describe('groupLines + headline', () => {
  it('mismatches first, alphabetical; headline counts them', () => {
    const g = groupLines([line('Victoria', 'MATCH'), line('Central', 'STALE_ALERT'), line('Bakerloo', 'HIDDEN_DISRUPTION')]);
    expect(g.mismatches.map((l) => l.lineName)).toEqual(['Bakerloo', 'Central']);
    expect(headline(g)).toEqual({ tone: 'alert', text: "2 lines don't match what's running" });
  });

  it('singular wording', () => {
    expect(headline(groupLines([line('A', 'HIDDEN_DISRUPTION')])).text).toBe("1 line doesn't match what's running");
  });

  it('all match', () => {
    expect(headline(groupLines([line('A', 'MATCH'), line('B', 'MATCH')]))).toEqual({ tone: 'ok', text: "All 2 lines match what's running" });
  });

  it('mixed: says what could not be checked', () => {
    const g = groupLines([line('A', 'MATCH'), line('B', 'CANT_VERIFY'), line('C', 'CLOSED')]);
    expect(headline(g).text).toBe("1 of 3 match · 1 can't be checked · 1 closed");
  });

  it('night: most lines closed', () => {
    const g = groupLines([line('A', 'CLOSED'), line('B', 'CLOSED'), line('C', 'CANT_VERIFY')]);
    expect(headline(g).text).toBe('Most lines are closed right now');
  });
});

describe('formatAge', () => {
  it.each([
    [4_000, '4s ago'],
    [59_000, '59s ago'],
    [61_000, '1 min ago'],
    [4 * 60_000, '4 min ago'],
    [3 * 3_600_000, '3 h ago'],
    [-500, '0s ago'],
  ])('%i ms → %s', (ms, text) => expect(formatAge(ms)).toBe(text));
});

describe('evidenceText', () => {
  it('next-train wait', () => {
    expect(evidenceText(ev({}))).toBe('southbound: next in 14 min (usually 3 min)');
  });
  it('gap between trains, estimated normal', () => {
    expect(evidenceText(ev({ gapKind: 'between', observedGapMin: 12, gapStartMin: 7, normalGapIsFallback: true }))).toBe(
      'southbound: 12 min gap from 7 min (usually 3 min, estimated)',
    );
  });
  it('unusable direction explains why', () => {
    expect(evidenceText(ev({ usable: false, issue: 'frozen', observedGapMin: null }))).toBe('southbound: predictions not updating');
  });
  it('no compass word: falls back to the platform', () => {
    expect(evidenceText(ev({ directionLabel: '', directionKey: 'platform:Platform 2', usable: false, issue: 'no-predictions', observedGapMin: null }))).toBe(
      'Platform 2: no services predicted',
    );
  });
});

describe('badgeLabel', () => {
  it('names a single disagreeing station as mixed signals', () => {
    expect(badgeLabel({ ...line('A', 'CANT_VERIFY'), reason: 'mixed-evidence' })).toBe('Mixed signals');
    expect(badgeLabel({ ...line('A', 'CANT_VERIFY'), reason: 'insufficient-data' })).toBe("Can't verify");
    expect(badgeLabel(line('A', 'HIDDEN_DISRUPTION'))).toBe('Worse than reported');
  });
});

describe('formatDue', () => {
  it.each([
    [-20_000, 'Due'],
    [25_000, 'Due'],
    [45_000, '1 min'],
    [150_000, '3 min'],
    [12 * 60_000, '12 min'],
  ])('%i ms ahead → %s', (ms, text) => expect(formatDue(1_000_000 + ms, 1_000_000)).toBe(text));
});
