import { LONDON_TZ } from '../config';
import type { Weekday } from './types';

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON_TZ,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const WEEKDAYS: Record<string, Weekday> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** London weekday and minutes since local midnight for an instant. DST-aware; pure. */
export function londonClock(epochMs: number): { weekday: Weekday; minutes: number } {
  let weekday: Weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const part of formatter.formatToParts(epochMs)) {
    if (part.type === 'weekday') weekday = WEEKDAYS[part.value] ?? 0;
    else if (part.type === 'hour') hour = Number(part.value);
    else if (part.type === 'minute') minute = Number(part.value);
  }
  return { weekday, minutes: hour * 60 + minute };
}
