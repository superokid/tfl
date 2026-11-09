import { RULES } from '../config';
import type { DirectionIssue, GapNorm, NormsOver, Prediction } from './types';

const MIN = 60_000;

export interface DirectionAnalysis {
  usable: boolean;
  issue: DirectionIssue | null;
  /** Timetable median, longest gap and threshold where the reported gap falls (at the check if unusable). */
  normalGapMin: number;
  scheduledGapMin: number;
  thresholdMin: number;
  observedGapMin: number | null;
  gapKind: 'next' | 'between' | null;
  /** When the largest gap starts, in minutes from now (0 for a wait for the next service). */
  gapStartMin: number | null;
  horizonMin: number | null;
}

/** max(multiplier × median, longest scheduled gap + extra): evenly spaced, longest = median (SPEC §5.2). */
export function thresholdFor(normalGapMin: number, longestGapMin = normalGapMin): number {
  return Math.max(RULES.thresholdMultiplier * normalGapMin, longestGapMin + RULES.thresholdExtraMin);
}

/** No timetable over time: the same gap everywhere (fallback gaps, tests). */
export const flatNorms =
  (normalGapMin: number): NormsOver =>
  () => ({ normalGapMin, longestGapMin: normalGapMin });

/**
 * SPEC §5.2 for one station × direction: the waits a passenger would see inside a window cut to the
 * prediction horizon, each judged against the timetable over its own stretch (`norms`). Reports the one
 * furthest over its threshold. `normalGapMin` (at the check) sizes the window and the horizon needed.
 * Never reports a gap after the last prediction.
 */
export function analyseDirection(
  predictions: Prediction[],
  now: number,
  normalGapMin: number,
  norms: NormsOver = flatNorms(normalGapMin),
): DirectionAnalysis {
  const atCheck: GapNorm = norms(0, 0);
  const unusable = (issue: DirectionIssue, horizonMin: number | null = null): DirectionAnalysis => ({
    usable: false,
    issue,
    normalGapMin: atCheck.normalGapMin,
    scheduledGapMin: atCheck.longestGapMin,
    thresholdMin: thresholdFor(atCheck.normalGapMin, atCheck.longestGapMin),
    observedGapMin: null,
    gapKind: null,
    gapStartMin: null,
    horizonMin,
  });

  if (predictions.length === 0) return unusable('no-predictions');

  const newestRead = Math.max(...predictions.map((p) => p.timingRead));
  if (now - newestRead > RULES.frozenFeedMin * MIN) return unusable('frozen');

  // One arrival per vehicle (TfL can list a vehicle twice); arrivals already due count as now.
  const byVehicle = new Map<string, number>();
  for (const p of predictions) {
    const t = Math.max(p.expectedArrival, now);
    const seen = byVehicle.get(p.vehicleId);
    if (seen === undefined || t < seen) byVehicle.set(p.vehicleId, t);
  }
  const times = [...byVehicle.values()].sort((a, b) => a - b);
  const last = times[times.length - 1] ?? now;
  const horizonMin = (last - now) / MIN;

  const windowMin =
    normalGapMin <= RULES.frequentNormalGapMaxMin ? RULES.windowFrequentMin : RULES.windowInfrequentMin;
  const windowEnd = now + Math.min(windowMin, horizonMin) * MIN;
  const inWindow = times.filter((t) => t <= windowEnd);

  let best = { ratio: 0, gapMs: 0, start: now, norm: atCheck, thresholdMin: thresholdFor(atCheck.normalGapMin, atCheck.longestGapMin) };
  const consider = (from: number, to: number) => {
    const norm = norms((from - now) / MIN, (to - now) / MIN);
    const thresholdMin = thresholdFor(norm.normalGapMin, norm.longestGapMin);
    const ratio = (to - from) / MIN / thresholdMin;
    if (ratio > best.ratio) best = { ratio, gapMs: to - from, start: from, norm, thresholdMin };
  };
  let prev = now;
  for (const t of inWindow) {
    consider(prev, t);
    prev = t;
  }
  // Arrivals continue past the window: the stretch from the last in-window arrival to the window end
  // is a real wait (at least that long). Without later arrivals we can't know, so it isn't counted.
  if (last > windowEnd) consider(prev, windowEnd);

  const observedGapMin = best.gapMs / MIN;
  const reachesFarEnough = horizonMin >= RULES.minHorizonNormalGaps * normalGapMin;
  if (!reachesFarEnough && best.ratio <= 1) return unusable('short-horizon', horizonMin);

  return {
    usable: true,
    issue: null,
    normalGapMin: best.norm.normalGapMin,
    scheduledGapMin: best.norm.longestGapMin,
    thresholdMin: best.thresholdMin,
    observedGapMin,
    gapKind: best.start === now ? 'next' : 'between',
    gapStartMin: (best.start - now) / MIN,
    horizonMin,
  };
}

/** "3", or "up to 7" when the timetable itself has longer gaps than its median (trams in pairs). */
export function usualGapText(e: { normalGapMin: number; scheduledGapMin?: number }): string {
  const normal = Math.round(e.normalGapMin);
  // Optional: a device copy saved before this field existed lacks it.
  const longest = Math.round(e.scheduledGapMin ?? e.normalGapMin);
  return longest > normal ? `up to ${longest}` : `${normal}`;
}
