import type { DirectionRef, ServiceDay, Weekday } from '../rules/types';
import railJson from './rail.json';
import type { DirectionFile, ReferenceFile } from './types';

// JSON imports widen string unions (e.g. mode), so cast through unknown. The shape is guarded by
// test/reference/rail-json.test.ts, which runs on every push.
export const RAIL_REFERENCE = railJson as unknown as ReferenceFile;

/** Compact on-disk direction → the engine's per-weekday form. */
export function expandDirection(d: DirectionFile): DirectionRef {
  const days: Partial<Record<Weekday, ServiceDay>> = {};
  d.weekdays.forEach((idx, w) => {
    const day = idx >= 0 ? d.serviceDays[idx] : undefined;
    if (day) days[w as Weekday] = day;
  });
  return { directionKey: d.directionKey, days };
}
