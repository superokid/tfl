import { describe, expect, it } from 'vitest';
import { activeStatuses, mapStatus } from '../../src/shared/rules/status';
import { at, MIN, status, TUE_10AM } from './builders';

describe('mapStatus (SPEC §5.1)', () => {
  it.each([
    ['Good Service', 'NORMAL'],
    ['No Issues', 'NORMAL'],
    ['Information', 'NORMAL'],
    ['No Step Free Access', 'NORMAL'],
    ['Minor Delays', 'MINOR'],
    ['Severe Delays', 'DEGRADED'],
    ['Reduced Service', 'DEGRADED'],
    ['Change of Frequency', 'DEGRADED'],
    ['Issues Reported', 'DEGRADED'],
    ['Special Service', 'DEGRADED'],
    ['Part Suspended', 'PARTIAL'],
    ['Part Closure', 'PARTIAL'],
    ['Part Closed', 'PARTIAL'],
    ['Diverted', 'PARTIAL'],
    ['Suspended', 'NONE'],
    ['Not Running', 'NONE'],
    ['Planned Closure', 'CLOSED'],
    ['Service Closed', 'CLOSED'],
    ['Closed', 'CLOSED'],
  ] as const)('%s → %s', (description, expected) => {
    expect(mapStatus(description)).toBe(expected);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(mapStatus('  good service ')).toBe('NORMAL');
  });

  it('returns null for an unknown description', () => {
    expect(mapStatus('Bus Service')).toBeNull();
  });
});

describe('activeStatuses: validity dates decide, never isNow', () => {
  const now = TUE_10AM;

  it('treats a status without validity periods as current', () => {
    expect(activeStatuses([status('Good Service')], now)).toHaveLength(1);
  });

  it('keeps a status whose period contains now', () => {
    const s = status('Minor Delays', { validityPeriods: [{ from: at(now, -10), to: at(now, 10) }] });
    expect(activeStatuses([s], now)).toEqual([s]);
  });

  it('drops expired and future statuses', () => {
    const expired = status('Suspended', { validityPeriods: [{ from: at(now, -60), to: at(now, -1) }] });
    const future = status('Planned Closure', { validityPeriods: [{ from: at(now, 60), to: at(now, 120) }] });
    expect(activeStatuses([expired, future], now)).toEqual([]);
  });

  it('keeps a status if any one of its periods is current', () => {
    const s = status('Part Closure', {
      validityPeriods: [
        { from: at(now, -120), to: at(now, -60) },
        { from: now - MIN, to: now + MIN },
      ],
    });
    expect(activeStatuses([s], now)).toEqual([s]);
  });
});
