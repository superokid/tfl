/**
 * Every tunable number for the rules (SPEC §5). Nothing numeric is inlined elsewhere.
 * Tuning against live data is recorded in docs/verification.md.
 */
export const RULES = {
  /** Gap threshold = max(multiplier × normal, normal + extraMin). */
  thresholdMultiplier: 2,
  thresholdExtraMin: 5,

  /** Look-ahead window: short for frequent services, long otherwise; cut to the prediction horizon. */
  frequentNormalGapMaxMin: 5,
  windowFrequentMin: 30,
  windowInfrequentMin: 60,

  /** A direction is usable only if predictions reach this many normal gaps ahead (or an over-threshold gap was seen). */
  minHorizonNormalGaps: 2,

  /** Feed is frozen if its newest `timing.read` is older than this. */
  frozenFeedMin: 3,

  /** Within this many minutes of the first or last journey, service is ramping: can't verify. */
  dayEdgeMin: 20,

  /** STALE_ALERT for a DEGRADED status: every gap at ≤ this × normal. */
  degradedNormalMultiplier: 1.5,

  /** Stations that must agree before any mismatch or match verdict. */
  minAgreeingStations: 2,
} as const;

export type Mode = 'tube' | 'elizabeth-line' | 'dlr' | 'overground' | 'tram' | 'cable-car' | 'bus';

/**
 * Per-mode default normal gap, used only when the timetable gives none (ADR-005).
 * Deliberately at the frequent end, and flagged: a fallback gap can never produce a mismatch.
 */
export const FALLBACK_NORMAL_GAP_MIN: Record<Mode, number> = {
  tube: 3,
  'elizabeth-line': 5,
  dlr: 5,
  overground: 10,
  tram: 7,
  'cable-car': 5,
  bus: 8,
};

/** What a passenger calls one vehicle on this mode, for plain-English evidence. */
export const VEHICLE_NOUN: Record<Mode, string> = {
  tube: 'train',
  'elizabeth-line': 'train',
  dlr: 'train',
  overground: 'train',
  tram: 'tram',
  'cable-car': 'cabin',
  bus: 'bus',
};

export const LONDON_TZ = 'Europe/London';
