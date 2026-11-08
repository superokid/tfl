import type { Expected, StatusInput } from './types';

/** SPEC §5.1. Keys are lower-case. Covers every rail description in /Line/Meta/Severity (fixture-tested). */
const STATUS_TABLE: Record<string, Expected> = {
  'good service': 'NORMAL',
  'no issues': 'NORMAL',
  information: 'NORMAL',
  'no step free access': 'NORMAL',
  'exit only': 'NORMAL', // a station-level restriction, not a service change
  'minor delays': 'MINOR',
  'severe delays': 'DEGRADED',
  'reduced service': 'DEGRADED',
  'change of frequency': 'DEGRADED',
  'issues reported': 'DEGRADED',
  'special service': 'DEGRADED',
  'part suspended': 'PARTIAL',
  'part closure': 'PARTIAL',
  'part closed': 'PARTIAL',
  diverted: 'PARTIAL',
  'bus service': 'PARTIAL', // rail replacement buses on a section
  suspended: 'NONE',
  'not running': 'NONE',
  'no service': 'NONE',
  'planned closure': 'CLOSED',
  'service closed': 'CLOSED',
  closed: 'CLOSED',
};

/** Most restrictive first; PARTIAL is resolved per station, so it isn't ranked. */
const RANK: Record<Exclude<Expected, 'PARTIAL'>, number> = {
  CLOSED: 4,
  NONE: 3,
  DEGRADED: 2,
  MINOR: 1,
  NORMAL: 0,
};

export function mapStatus(description: string): Expected | null {
  return STATUS_TABLE[description.trim().toLowerCase()] ?? null;
}

/** Statuses valid at `now`, decided by validity dates (TfL's `isNow` is unreliable). */
export function activeStatuses(statuses: StatusInput[], now: number): StatusInput[] {
  return statuses.filter(
    (s) => s.validityPeriods.length === 0 || s.validityPeriods.some((p) => p.from <= now && now <= p.to),
  );
}

export function mostRestrictive(expected: Exclude<Expected, 'PARTIAL'>[]): Exclude<Expected, 'PARTIAL'> {
  return expected.reduce<Exclude<Expected, 'PARTIAL'>>(
    (worst, e) => (RANK[e] > RANK[worst] ? e : worst),
    'NORMAL',
  );
}
