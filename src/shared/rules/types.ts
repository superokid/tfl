/**
 * Domain model for the rules engine. The engine never sees raw TfL JSON: a parser at the boundary
 * (Phase 1/4, built against real fixtures) turns TfL responses into these types.
 * All times are epoch milliseconds; all durations are minutes.
 */
import type { Mode } from '../config';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, as Date#getDay

/** One official status line from TfL, as published. */
export interface StatusInput {
  /** TfL's `statusSeverityDescription`, e.g. "Good Service", "Part Suspended". */
  description: string;
  /** TfL's validity periods. Empty = valid now (TfL omits them for routine statuses). `isNow` is ignored. */
  validityPeriods: { from: number; to: number }[];
  /** NaPTAN ids of stops the disruption covers (`?detail=true`), when TfL lists them. */
  affectedStopIds: string[];
  /** TfL's message for passengers, e.g. "Minor delays due to train cancellations." Display only. */
  reason: string | null;
}

export interface Prediction {
  vehicleId: string;
  /** Stable key used to match reference data: TfL `direction`, else derived from `platformName`. */
  directionKey: string;
  /** Passenger wording from the platform, e.g. "southbound"; empty when the platform has none ("Platform 2"). */
  directionLabel: string;
  expectedArrival: number;
  /** TfL `timing.read`: when the prediction was produced. */
  timingRead: number;
  /** Has a destination. TfL lists unconfirmed vehicles (no destination, "Check Front of Train"), seen
   * moving inside a suspended section; they never count as proof that a service is running. */
  confirmed: boolean;
  /** Terminates at this stop: at a suspension boundary these arrive but don't continue. */
  terminatesHere: boolean;
  /** Where it's going, for the arrivals board ("Brixton"). Display only. */
  destination: string | null;
  /** Physical platform ("Northbound - Platform 1", "Platform 8"); null if TfL says unknown. Display only:
   * boards group by platform because TfL's `direction` is sometimes wrong (Elizabeth line at Stratford). */
  platform: string | null;
}

export type ArrivalsFailure = 'failed' | 'invalid' | 'budget';

export type StationArrivals =
  | { ok: true; predictions: Prediction[] }
  | { ok: false; failure: ArrivalsFailure };

export interface ServiceBand {
  /** Minutes since local midnight of the service day; may exceed 1440 for after-midnight service. */
  fromMin: number;
  toMin: number;
  /** Median scheduled gap between departures starting in this band. */
  normalGapMin: number;
  /** Longest scheduled gap starting in this band. Trams in pairs (1 min, then 7) have a median of 4, but
   * passengers routinely wait 7; the last trams of the night can be 15 apart. */
  longestGapMin: number;
}

/** What the timetable leads a passenger to expect over a stretch of time. */
export interface GapNorm {
  normalGapMin: number;
  longestGapMin: number;
}

/** The timetable's gaps for the stretch `fromMin`–`toMin` minutes after the check. */
export type NormsOver = (fromMin: number, toMin: number) => GapNorm;

export interface ServiceDay {
  /** First and last journey, minutes since local midnight of the service day (last may be ≥ 1440). */
  firstMin: number;
  lastMin: number;
  bands: ServiceBand[];
}

/** Timetable-derived reference for one direction at one check station. */
export interface DirectionRef {
  directionKey: string;
  /** Service day by weekday; a missing weekday means no service that day. */
  days: Partial<Record<Weekday, ServiceDay>>;
}

export interface CheckStation {
  stopId: string;
  name: string;
  /** Empty when the timetable couldn't be derived: the engine uses the per-mode fallback gap. */
  directions: DirectionRef[];
  arrivals: StationArrivals;
}

export interface LineInput {
  lineId: string;
  lineName: string;
  mode: Mode;
  statuses: StatusInput[];
  /** Usually 2. Empty for status-only lines (e.g. Cable Car, which has no predictions). */
  stations: CheckStation[];
}

export type Expected = 'NORMAL' | 'MINOR' | 'DEGRADED' | 'PARTIAL' | 'NONE' | 'CLOSED';

export type VerdictKind = 'HIDDEN_DISRUPTION' | 'STALE_ALERT' | 'MATCH' | 'CANT_VERIFY' | 'CLOSED';

export type VerdictReason =
  // CANT_VERIFY
  | 'status-only'
  | 'unknown-status'
  | 'partial-unlocated'
  | 'insufficient-data'
  | 'fallback-gap'
  | 'mixed-evidence'
  // CLOSED
  | 'planned-closure'
  | 'outside-hours';

export type DirectionIssue =
  | 'failed'
  | 'invalid'
  | 'budget'
  | 'no-predictions'
  | 'frozen'
  | 'short-horizon'
  | 'outside-hours'
  | 'day-edge';

export interface DirectionEvidence {
  stopId: string;
  stationName: string;
  directionKey: string;
  directionLabel: string;
  /** Median scheduled gap where the reported gap falls (at the check, for an unusable direction). */
  normalGapMin: number;
  /** Longest scheduled gap over that same stretch: what "usually" means to a passenger. */
  scheduledGapMin: number;
  normalGapIsFallback: boolean;
  /** Threshold for the reported gap, from the timetable over its own stretch. */
  thresholdMin: number;
  /** The gap furthest over (or closest to) its own threshold inside the window, or null if unusable. */
  observedGapMin: number | null;
  /** 'next' = now → first arrival; 'between' = two consecutive arrivals. */
  gapKind: 'next' | 'between' | null;
  /** When that gap starts, in minutes from the check (0 for 'next'). */
  gapStartMin: number | null;
  horizonMin: number | null;
  usable: boolean;
  issue: DirectionIssue | null;
}

export interface LineVerdict {
  lineId: string;
  lineName: string;
  mode: Mode;
  verdict: VerdictKind;
  reason: VerdictReason | null;
  /** The official status as published, e.g. "Good Service" or "Severe Delays, Part Suspended". */
  tflSays: string;
  /** One plain-English sentence for the card. */
  summary: string;
  evidence: DirectionEvidence[];
  checkedAt: number;
}
