import { RULES } from '../config';
import type { DirectionIssue, Prediction } from './types';

const MIN = 60_000;

export interface DirectionAnalysis {
  usable: boolean;
  issue: DirectionIssue | null;
  thresholdMin: number;
  observedGapMin: number | null;
  gapKind: 'next' | 'between' | null;
  horizonMin: number | null;
}

export function thresholdFor(normalGapMin: number): number {
  return Math.max(RULES.thresholdMultiplier * normalGapMin, normalGapMin + RULES.thresholdExtraMin);
}

/**
 * SPEC §5.2 for one station × direction: the largest wait a passenger would see, inside a window
 * cut to the prediction horizon. Never reports a gap after the last prediction.
 */
export function analyseDirection(predictions: Prediction[], now: number, normalGapMin: number): DirectionAnalysis {
  const thresholdMin = thresholdFor(normalGapMin);
  const unusable = (issue: DirectionIssue, horizonMin: number | null = null): DirectionAnalysis => ({
    usable: false,
    issue,
    thresholdMin,
    observedGapMin: null,
    gapKind: null,
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

  let gapMs = 0;
  let gapKind: 'next' | 'between' = 'next';
  let prev = now;
  for (const t of inWindow) {
    if (t - prev > gapMs) {
      gapMs = t - prev;
      gapKind = prev === now ? 'next' : 'between';
    }
    prev = t;
  }
  // Arrivals continue past the window: the stretch from the last in-window arrival to the window end
  // is a real wait (at least that long). Without later arrivals we can't know, so it isn't counted.
  if (last > windowEnd && windowEnd - prev > gapMs) {
    gapMs = windowEnd - prev;
    gapKind = prev === now ? 'next' : 'between';
  }

  const observedGapMin = gapMs / MIN;
  const reachesFarEnough = horizonMin >= RULES.minHorizonNormalGaps * normalGapMin;
  if (!reachesFarEnough && observedGapMin <= thresholdMin) return unusable('short-horizon', horizonMin);

  return { usable: true, issue: null, thresholdMin, observedGapMin, gapKind, horizonMin };
}
