import { afterEach, describe, expect, it, vi } from 'vitest';
import { judgeLine } from '../../src/shared/rules/verdict';
import type { Weekday } from '../../src/shared/rules/types';
import {
  at,
  dirRef,
  every,
  line,
  ok,
  preds,
  regularLine,
  serviceDay,
  station,
  status,
  TUE_10AM,
} from './builders';

const now = TUE_10AM;

/** Two stations, each with its own minute list, normal gap 3. */
function twoStations(a: number[], b: number[], statuses = [status('Good Service')], normal = 3) {
  return line(statuses, [
    station('Euston', ok(preds(now, a)), [dirRef('outbound', normal)], 'euston'),
    station('Brixton', ok(preds(now, b)), [dirRef('outbound', normal)], 'brixton'),
  ]);
}

const LONG = [14, 17, 20, 23, 26, 29]; // next train 14 min away
const NORMAL = every(3, 30);

describe('MATCH', () => {
  it('Good Service and regular trains at both stations', () => {
    const v = judgeLine(regularLine(now, [status('Good Service')]), now);
    expect(v).toMatchObject({ verdict: 'MATCH', reason: null, tflSays: 'Good Service' });
    expect(v.evidence).toHaveLength(2);
  });

  it('Severe Delays confirmed by long gaps', () => {
    expect(judgeLine(twoStations(LONG, LONG, [status('Severe Delays')]), now).verdict).toBe('MATCH');
  });

  it('a long gap at only one station is not enough to flag, and is not a match either', () => {
    expect(judgeLine(twoStations(LONG, NORMAL), now)).toMatchObject({
      verdict: 'CANT_VERIFY',
      reason: 'mixed-evidence',
      summary: "Services at Euston don't fit TfL's status, but one station isn't enough to flag it.",
    });
  });

  it('Part Closure: one station inside the closure with trains running is not a match (live Lioness case)', () => {
    const closure = status('Part Closure', { affectedStopIds: ['euston'] });
    expect(judgeLine(twoStations(NORMAL, NORMAL, [closure]), now).reason).toBe('mixed-evidence');
  });
});

describe('HIDDEN_DISRUPTION', () => {
  it('Good Service, but both stations show over-threshold gaps', () => {
    const v = judgeLine(twoStations(LONG, LONG), now);
    expect(v.verdict).toBe('HIDDEN_DISRUPTION');
    expect(v.summary).toBe(
      'TfL says Good Service, but the next southbound train at Euston is 14 minutes away (usually 3).',
    );
  });

  it('Minor Delays understated by long gaps at 2 stations', () => {
    expect(judgeLine(twoStations(LONG, LONG, [status('Minor Delays')]), now).verdict).toBe(
      'HIDDEN_DISRUPTION',
    );
  });

  it('describes a gap between trains differently from a wait for the next one', () => {
    const between = [1, 4, 7, 19, 22, 25, 28];
    const v = judgeLine(twoStations(between, between), now);
    expect(v.summary).toBe(
      "TfL says Good Service, but there's a 12-minute gap between southbound trains at Euston, starting in 7 minutes (usually 3).",
    );
  });

  it('infrequent line: judged against its own normal gap', () => {
    // Overground every 15: a 20-min gap is normal noise (threshold 30), a 40-min gap is not.
    const ok20 = twoStations([5, 25, 40, 55], [5, 25, 40, 55], undefined, 15);
    const bad40 = twoStations([2, 42, 57], [2, 42, 57], undefined, 15);
    expect(judgeLine(ok20, now).verdict).toBe('MATCH');
    expect(judgeLine(bad40, now).verdict).toBe('HIDDEN_DISRUPTION');
  });
});

describe('summary wording', () => {
  it.each([
    [[1, 4, 7, 25, 28], "an 18-minute gap"],
    [[1, 4, 7, 18, 21, 24, 27], "an 11-minute gap"],
    [[1, 4, 7, 16, 19, 22, 25, 28], "a 9-minute gap"],
  ])('uses the right article (%j)', (mins, phrase) => {
    expect(judgeLine(twoStations(mins, mins), now).summary).toContain(phrase);
  });
});

describe('STALE_ALERT', () => {
  it('Suspended, but normal service at both stations', () => {
    const v = judgeLine(twoStations(NORMAL, NORMAL, [status('Suspended')]), now);
    expect(v.verdict).toBe('STALE_ALERT');
    expect(v.summary).toBe('TfL says Suspended, but trains are running normally at Euston and Brixton.');
  });

  it('Severe Delays, but every gap is near normal at both stations', () => {
    expect(judgeLine(twoStations(NORMAL, NORMAL, [status('Severe Delays')]), now).verdict).toBe(
      'STALE_ALERT',
    );
  });

  it('Severe Delays with gaps between 1.5× normal and the threshold is not flagged', () => {
    const fiveMin = every(5, 30); // normal 3: 5 > 4.5, but under threshold 8
    expect(judgeLine(twoStations(fiveMin, fiveMin, [status('Severe Delays')]), now).verdict).toBe(
      'MATCH',
    );
  });
});

describe('STALE_ALERT is not fooled by what TfL shows inside a live suspension (Phase 1, Bakerloo)', () => {
  const both = (stopId: string, out: ReturnType<typeof preds>, inb: ReturnType<typeof preds>) =>
    station(stopId, ok([...out, ...inb]), [dirRef('outbound', 3), dirRef('inbound', 3)], stopId);
  const suspended = [status('Part Suspended', { affectedStopIds: ['harlesden', 'willesden'] })];

  it('unconfirmed vehicles (no destination) never prove service is running', () => {
    const ghost = { confirmed: false };
    const l = line(suspended, [
      both('harlesden', preds(now, NORMAL, 'outbound', 'northbound', 0.5, ghost), preds(now, NORMAL, 'inbound', 'southbound', 0.5, ghost)),
      both('willesden', preds(now, NORMAL, 'outbound', 'northbound', 0.5, ghost), preds(now, NORMAL, 'inbound', 'southbound', 0.5, ghost)),
    ]);
    expect(judgeLine(l, now).verdict).not.toBe('STALE_ALERT');
  });

  it('a boundary stop (trains terminate one way, start the other) is not "running normally"', () => {
    const terminating = { terminatesHere: true };
    const edge = (id: string) =>
      both(id, preds(now, NORMAL, 'outbound', 'northbound', 0.5, terminating), preds(now, NORMAL, 'inbound', 'southbound'));
    const l = line([status('Part Suspended', { affectedStopIds: ['queens-park', 'harlesden'] })], [edge('queens-park'), edge('harlesden')]);
    expect(judgeLine(l, now).verdict).not.toBe('STALE_ALERT');
  });

  it('needs every direction running: one direction alone is not enough', () => {
    const l = line(suspended, [
      both('harlesden', preds(now, NORMAL, 'outbound', 'northbound'), []),
      both('willesden', preds(now, NORMAL, 'outbound', 'northbound'), []),
    ]);
    expect(judgeLine(l, now).verdict).not.toBe('STALE_ALERT');
  });

  it('through services in both directions are still flagged', () => {
    const l = line(suspended, [
      both('harlesden', preds(now, NORMAL, 'outbound', 'northbound'), preds(now, NORMAL, 'inbound', 'southbound')),
      both('willesden', preds(now, NORMAL, 'outbound', 'northbound'), preds(now, NORMAL, 'inbound', 'southbound')),
    ]);
    expect(judgeLine(l, now).verdict).toBe('STALE_ALERT');
  });

  it('gap checks count unconfirmed trains, so missing destinations never fake a gap', () => {
    const mixed = (n: number) => preds(now, NORMAL).map((p, i) => ({ ...p, confirmed: i % 2 === n }));
    const l = line([status('Good Service')], [station('Euston', ok(mixed(0))), station('Brixton', ok(mixed(1)))]);
    expect(judgeLine(l, now).verdict).toBe('MATCH');
  });

  it('platforms without a compass word give a sentence without one', () => {
    const l = line([status('Good Service')], [
      station('Bond Street', ok(preds(now, LONG, 'outbound', ''))),
      station('Whitechapel', ok(preds(now, LONG, 'outbound', ''))),
    ]);
    expect(judgeLine(l, now).summary).toBe('TfL says Good Service, but the next train at Bond Street is 14 minutes away (usually 3).');
  });
});

describe('CANT_VERIFY: never a guessed "OK"', () => {
  it('empty predictions at both stations', () => {
    expect(judgeLine(twoStations([], []), now)).toMatchObject({
      verdict: 'CANT_VERIFY',
      reason: 'insufficient-data',
    });
  });

  it('empty predictions at one station leaves too few usable stations', () => {
    expect(judgeLine(twoStations([], NORMAL), now).verdict).toBe('CANT_VERIFY');
  });

  it('Suspended with no predictions anywhere is unverifiable, not a match', () => {
    expect(judgeLine(twoStations([], [], [status('Suspended')]), now).verdict).toBe('CANT_VERIFY');
  });

  it('frozen feed at both stations', () => {
    const frozen = preds(now, LONG, 'outbound', 'southbound', 10);
    const l = line(
      [status('Good Service')],
      [station('Euston', ok(frozen)), station('Brixton', ok(frozen))],
    );
    expect(judgeLine(l, now).verdict).toBe('CANT_VERIFY');
  });

  it.each(['failed', 'invalid', 'budget'] as const)('arrivals call %s', (failure) => {
    const l = line(
      [status('Good Service')],
      [station('Euston', { ok: false, failure }), station('Brixton', { ok: false, failure })],
    );
    const v = judgeLine(l, now);
    expect(v.verdict).toBe('CANT_VERIFY');
    expect(v.evidence.every((e) => e.issue === failure)).toBe(true);
  });

  it('status-only line (Cable Car: no predictions exist)', () => {
    const l = { ...line([status('Good Service')], []), mode: 'cable-car' as const };
    expect(judgeLine(l, now)).toMatchObject({ verdict: 'CANT_VERIFY', reason: 'status-only' });
  });

  it('unknown status description', () => {
    expect(judgeLine(regularLine(now, [status('Teleporting')]), now)).toMatchObject({
      verdict: 'CANT_VERIFY',
      reason: 'unknown-status',
    });
  });

  it('no status currently valid', () => {
    const expired = status('Good Service', { validityPeriods: [{ from: at(now, -60), to: at(now, -1) }] });
    expect(judgeLine(regularLine(now, [expired]), now).reason).toBe('unknown-status');
  });
});

describe('fallback normal gap never produces a mismatch', () => {
  const noTimetable = (a: number[], b: number[], s = [status('Good Service')]) =>
    line(s, [station('Euston', ok(preds(now, a)), []), station('Brixton', ok(preds(now, b)), [])]);

  it('long gaps without a timetable → CANT_VERIFY, not HIDDEN_DISRUPTION', () => {
    expect(judgeLine(noTimetable(LONG, LONG), now)).toMatchObject({
      verdict: 'CANT_VERIFY',
      reason: 'fallback-gap',
    });
  });

  it('Suspended and trains running, without a timetable → CANT_VERIFY, not STALE_ALERT', () => {
    expect(judgeLine(noTimetable(NORMAL, NORMAL, [status('Suspended')]), now).reason).toBe(
      'fallback-gap',
    );
  });

  it('a fallback gap may still confirm a match', () => {
    const v = judgeLine(noTimetable(NORMAL, NORMAL), now);
    expect(v.verdict).toBe('MATCH');
    expect(v.evidence.every((e) => e.normalGapIsFallback)).toBe(true);
  });
});

describe('statuses: several at once, partial, validity', () => {
  it('validity dates decide: an expired Suspended is ignored', () => {
    const expired = status('Suspended', { validityPeriods: [{ from: at(now, -90), to: at(now, -30) }] });
    expect(judgeLine(regularLine(now, [expired, status('Good Service')]), now)).toMatchObject({
      verdict: 'MATCH',
      tflSays: 'Good Service',
    });
  });

  it('the most restrictive non-partial status wins (Minor + Severe → Severe)', () => {
    const v = judgeLine(twoStations(NORMAL, NORMAL, [status('Minor Delays'), status('Severe Delays')]), now);
    expect(v.verdict).toBe('STALE_ALERT');
    expect(v.tflSays).toBe('Minor Delays, Severe Delays');
  });

  it('Part Suspended without affected stops → CANT_VERIFY', () => {
    expect(judgeLine(twoStations(NORMAL, NORMAL, [status('Part Suspended')]), now).reason).toBe(
      'partial-unlocated',
    );
  });

  it('Part Suspended whose stops miss every check station → CANT_VERIFY', () => {
    const s = status('Part Suspended', { affectedStopIds: ['somewhere-else'] });
    expect(judgeLine(twoStations(NORMAL, NORMAL, [s]), now).reason).toBe('partial-unlocated');
  });

  it('Part Suspended covering both check stations, trains running → STALE_ALERT', () => {
    const s = status('Part Suspended', { affectedStopIds: ['euston', 'brixton'] });
    expect(judgeLine(twoStations(NORMAL, NORMAL, [s]), now).verdict).toBe('STALE_ALERT');
  });

  it('Severe Delays + Part Suspended (two statuses on one line, as seen live on the Bakerloo)', () => {
    const partial = status('Part Suspended', { affectedStopIds: ['euston'] });
    const v = judgeLine(twoStations(LONG, LONG, [status('Severe Delays'), partial]), now);
    // Euston is in the suspended section, Brixton has Severe Delays: long gaps agree with both.
    expect(v.verdict).toBe('MATCH');
    expect(v.tflSays).toBe('Severe Delays, Part Suspended');
  });
});

describe('CLOSED and operating hours', () => {
  it('Planned Closure', () => {
    expect(judgeLine(twoStations([], [], [status('Planned Closure')]), now)).toMatchObject({
      verdict: 'CLOSED',
      reason: 'planned-closure',
    });
  });

  it('03:00 on a weekday: outside timetable hours, never a mismatch', () => {
    const night = Date.UTC(2026, 10, 10, 3, 0);
    expect(judgeLine(twoStations([], []), night)).toMatchObject({
      verdict: 'CLOSED',
      reason: 'outside-hours',
    });
  });

  it('within 20 min of the first journey: can\'t verify', () => {
    const early = Date.UTC(2026, 10, 10, 5, 40); // first journey 05:30
    const l = twoStations([], []);
    l.stations.forEach((s) => (s.arrivals = ok(preds(early, LONG))));
    const v = judgeLine(l, early);
    expect(v.verdict).toBe('CANT_VERIFY');
    expect(v.evidence.every((e) => e.issue === 'day-edge')).toBe(true);
  });

  it('within 20 min of the last journey: can\'t verify', () => {
    const late = Date.UTC(2026, 10, 11, 0, 20); // last journey 00:30 (minute 1470 of Tuesday)
    const l = twoStations([], []);
    l.stations.forEach((s) => (s.arrivals = ok(preds(late, LONG))));
    expect(judgeLine(l, late).verdict).toBe('CANT_VERIFY');
  });

  it('non-operating day (no Sunday service) → CLOSED', () => {
    const sunday = Date.UTC(2026, 10, 8, 12, 0);
    const weekdays: Weekday[] = [1, 2, 3, 4, 5, 6];
    const l = line(
      [status('Good Service')],
      [
        station('Bank', ok([]), [dirRef('outbound', 4, weekdays, serviceDay(4, 330, 1410))]),
        station('Waterloo', ok([]), [dirRef('outbound', 4, weekdays, serviceDay(4, 330, 1410))]),
      ],
    );
    expect(judgeLine(l, sunday)).toMatchObject({ verdict: 'CLOSED', reason: 'outside-hours' });
  });

  it("Night Tube: Saturday 03:00 belongs to Friday's service day (hour ≥ 24)", () => {
    const satNight = Date.UTC(2026, 10, 14, 3, 0);
    const friNight = serviceDay(10, 330, 24 * 60 + 5 * 60); // Friday runs until 05:00 Saturday
    const ref = dirRef('outbound', 10, [5], friNight);
    const tenMin = every(10, 60);
    const l = line(
      [status('Good Service')],
      [
        station('Oxford Circus', ok(preds(satNight, tenMin)), [ref]),
        station('Victoria', ok(preds(satNight, tenMin)), [ref]),
      ],
    );
    expect(judgeLine(l, satNight).verdict).toBe('MATCH');
  });

  it('DST: 01:30 BST in summer is outside hours on a weekday', () => {
    const bstNight = Date.UTC(2026, 6, 15, 0, 30); // 01:30 BST, Wed
    expect(judgeLine(twoStations([], []), bstNight).verdict).toBe('CLOSED');
  });
});

describe('purity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never reads the clock and is deterministic', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('rules engine must not call Date.now()');
    });
    const input = twoStations(LONG, LONG);
    expect(judgeLine(input, now)).toEqual(judgeLine(input, now));
  });

  it('does not mutate its input', () => {
    const input = twoStations(LONG, NORMAL);
    const before = structuredClone(input);
    judgeLine(input, now);
    expect(input).toEqual(before);
  });
});
