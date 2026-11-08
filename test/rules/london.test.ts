import { describe, expect, it } from 'vitest';
import { londonClock } from '../../src/shared/rules/london';

describe('londonClock', () => {
  it('reads GMT in winter', () => {
    expect(londonClock(Date.UTC(2026, 10, 10, 10, 0))).toEqual({ weekday: 2, minutes: 600 });
  });

  it('reads BST in summer (UTC+1)', () => {
    expect(londonClock(Date.UTC(2026, 6, 15, 9, 30))).toEqual({ weekday: 3, minutes: 630 });
  });

  it('crosses midnight into the next London day under BST', () => {
    // 23:30 UTC on Fri 3 Jul = 00:30 BST on Sat 4 Jul.
    expect(londonClock(Date.UTC(2026, 6, 3, 23, 30))).toEqual({ weekday: 6, minutes: 30 });
  });

  it('handles the spring-forward day (29 Mar 2026, 01:00 UTC)', () => {
    expect(londonClock(Date.UTC(2026, 2, 29, 0, 59)).minutes).toBe(59); // 00:59 GMT
    expect(londonClock(Date.UTC(2026, 2, 29, 1, 0)).minutes).toBe(120); // 02:00 BST
  });

  it('handles the fall-back day (25 Oct 2026, 01:00 UTC)', () => {
    expect(londonClock(Date.UTC(2026, 9, 25, 0, 30)).minutes).toBe(90); // 01:30 BST
    expect(londonClock(Date.UTC(2026, 9, 25, 1, 30)).minutes).toBe(90); // 01:30 GMT, again
  });
});
