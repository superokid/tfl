import { describe, expect, it } from 'vitest';
import { nextFirstTrain, resumeTimeFromMessage } from '../../src/shared/rules/hours';
import type { Weekday } from '../../src/shared/rules/types';
import { dirRef, serviceDay } from './builders';

const weekdays: Weekday[] = [1, 2, 3, 4, 5];

describe('nextFirstTrain', () => {
  it('01:10 on a weekday: first train at 05:30 the same morning', () => {
    const night = Date.UTC(2026, 10, 10, 1, 10); // Tue, GMT
    // Monday's service ends 00:30 (minute 1470), so 01:10 is outside hours.
    expect(nextFirstTrain([dirRef('outbound', 3)], night)).toBe(Date.UTC(2026, 10, 10, 5, 30));
  });

  it('takes the earliest across directions', () => {
    const night = Date.UTC(2026, 10, 10, 2, 0);
    const refs = [dirRef('outbound', 3, undefined, serviceDay(3, 345)), dirRef('inbound', 3, undefined, serviceDay(3, 335))];
    expect(nextFirstTrain(refs, night)).toBe(Date.UTC(2026, 10, 10, 5, 35));
  });

  it('null while any direction is running, or with no timetable', () => {
    expect(nextFirstTrain([dirRef('outbound', 3)], Date.UTC(2026, 10, 10, 12, 0))).toBeNull();
    expect(nextFirstTrain([], Date.UTC(2026, 10, 10, 2, 0))).toBeNull();
  });

  it('no Sunday service: Sunday noon → Monday morning', () => {
    const sunday = Date.UTC(2026, 10, 8, 12, 0);
    const refs = [dirRef('outbound', 4, weekdays, serviceDay(4, 360, 1410))];
    expect(nextFirstTrain(refs, sunday)).toBe(Date.UTC(2026, 10, 9, 6, 0));
  });

  it('late evening after the last train: tomorrow morning', () => {
    const late = Date.UTC(2026, 10, 10, 23, 50); // Tue 23:50, service ends 23:30
    const refs = [dirRef('outbound', 4, undefined, serviceDay(4, 330, 1410))];
    expect(nextFirstTrain(refs, late)).toBe(Date.UTC(2026, 10, 11, 5, 30));
  });

  it('across the spring clock change: 05:30 BST is 04:30 UTC', () => {
    const night = Date.UTC(2026, 2, 29, 0, 45); // Sun 29 Mar 2026, 00:45 GMT; clocks go forward at 01:00
    const refs = [dirRef('outbound', 4, undefined, serviceDay(4, 330, 1410))];
    expect(nextFirstTrain(refs, night)).toBe(Date.UTC(2026, 2, 29, 4, 30));
  });
});

describe('resumeTimeFromMessage', () => {
  const night = Date.UTC(2026, 10, 9, 1, 10);
  it('reads an explicit time', () => {
    expect(resumeTimeFromMessage('Waterloo and City Line: Service will resume at 06:00.', night)).toBe(Date.UTC(2026, 10, 9, 6, 0));
  });
  it('a time already passed today means tomorrow', () => {
    expect(resumeTimeFromMessage('Service will resume at 00:30.', night)).toBe(Date.UTC(2026, 10, 10, 0, 30));
  });
  it('null without a time', () => {
    expect(resumeTimeFromMessage('Service will resume later this morning.', night)).toBeNull();
  });
});
