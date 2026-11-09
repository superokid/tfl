/** Operating hours from the timetable reference: in service now, and when the first train runs next. Pure. */
import { RULES } from '../config';
import { londonClock } from './london';
import type { DirectionRef, NormsOver, ServiceBand, Weekday } from './types';

/** In service: the median gap at `now` (null if the timetable has none), and the timetable's gaps over any
 * stretch ahead, so each gap is judged where it falls (null with no band at `now`). */
export type ServiceState =
  | { kind: 'in'; normalGapMin: number | null; norms: NormsOver | null }
  | { kind: 'outside' }
  | { kind: 'edge' };

/** Is this direction in service now? Checks today's service day and yesterday's after-midnight tail. */
export function serviceAt(ref: DirectionRef, now: number): ServiceState {
  const { weekday, minutes } = londonClock(now);
  const yesterday = ((weekday + 6) % 7) as Weekday;
  const candidates = [
    { day: ref.days[weekday], t: minutes },
    { day: ref.days[yesterday], t: minutes + 1440 },
  ];
  for (const { day, t } of candidates) {
    if (!day || t < day.firstMin || t > day.lastMin) continue;
    if (t - day.firstMin < RULES.dayEdgeMin || day.lastMin - t < RULES.dayEdgeMin) return { kind: 'edge' };
    const band = day.bands.find((b) => b.fromMin <= t && t < b.toMin);
    if (!band) return { kind: 'in', normalGapMin: null, norms: null };
    return { kind: 'in', normalGapMin: band.normalGapMin, norms: normsOver(day.bands, band, t) };
  }
  return { kind: 'outside' };
}

/**
 * The largest median and longest gap among the bands a stretch overlaps (a gap crossing into a sparser
 * hour is judged by the sparser one), or the band at the check if it overlaps none (after the last journey).
 * Wall-clock minutes: a clock change inside the stretch is off by up to an hour, at 01:00–02:00 only.
 */
function normsOver(bands: ServiceBand[], atNow: ServiceBand, t: number): NormsOver {
  return (fromMin, toMin) => {
    const hit = bands.filter((b) => b.fromMin < t + toMin && t + fromMin < b.toMin);
    const use = hit.length > 0 ? hit : [atNow];
    return {
      normalGapMin: Math.max(...use.map((b) => b.normalGapMin)),
      longestGapMin: Math.max(...use.map((b) => b.longestGapMin)),
    };
  };
}

/** Epoch ms of London clock time `minuteOfDay`, `dayOffset` London days after `now`'s. DST-safe. */
function londonTime(now: number, dayOffset: number, minuteOfDay: number): number {
  const { minutes } = londonClock(now);
  const startOfMinute = now - (now % 60_000);
  let t = startOfMinute + (dayOffset * 1440 + minuteOfDay - minutes) * 60_000;
  // Crossing a clock change shifts the wall clock by an hour: correct once against London time.
  const drift = (minuteOfDay - londonClock(t).minutes + 2160) % 1440 - 720;
  t += drift * 60_000;
  return t;
}

/**
 * When the first train runs next across these directions, if none is in service now (epoch ms).
 * Null when any direction is running, or there is no timetable.
 */
export function nextFirstTrain(refs: DirectionRef[], now: number): number | null {
  if (refs.length === 0 || refs.some((r) => serviceAt(r, now).kind !== 'outside')) return null;
  const { weekday, minutes } = londonClock(now);
  let best: { offset: number; min: number } | null = null;
  for (const ref of refs) {
    for (let offset = 0; offset <= 7; offset++) {
      const day = ref.days[((weekday + offset) % 7) as Weekday];
      if (!day || (offset === 0 && day.firstMin <= minutes)) continue;
      if (!best || offset * 1440 + day.firstMin < best.offset * 1440 + best.min) best = { offset, min: day.firstMin };
      break;
    }
  }
  return best ? londonTime(now, best.offset, best.min) : null;
}

/** TfL's own time, e.g. "Service will resume at 06:00." → the next 06:00 London after `now`. */
export function resumeTimeFromMessage(message: string, now: number): number | null {
  const m = /\bresume (?:at|from) (\d{1,2})[:.](\d{2})\b/i.exec(message);
  if (!m) return null;
  const minuteOfDay = Number(m[1]) * 60 + Number(m[2]);
  if (minuteOfDay >= 1440) return null;
  const today = londonTime(now, 0, minuteOfDay);
  return today > now ? today : londonTime(now, 1, minuteOfDay);
}
