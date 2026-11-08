/** Small builders so each rule test reads as the scenario it checks. */
import type { Mode } from '../../src/shared/config';
import type {
  CheckStation,
  DirectionRef,
  LineInput,
  Prediction,
  ServiceDay,
  StationArrivals,
  StatusInput,
  Weekday,
} from '../../src/shared/rules/types';

export const MIN = 60_000;

/** Tuesday 10 Nov 2026, 10:00 London (GMT, so also 10:00 UTC). Midday, off-peak, mid-week. */
export const TUE_10AM = Date.UTC(2026, 10, 10, 10, 0);

export const at = (base: number, minutes: number) => base + minutes * MIN;

const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** A service day running 05:30 → 00:30 with one flat normal gap. */
export function serviceDay(normalGapMin: number, firstMin = 330, lastMin = 1470): ServiceDay {
  return { firstMin, lastMin, bands: [{ fromMin: firstMin, toMin: lastMin, normalGapMin }] };
}

export function dirRef(
  directionKey: string,
  normalGapMin: number,
  days: Weekday[] = ALL_DAYS,
  day: ServiceDay = serviceDay(normalGapMin),
): DirectionRef {
  return { directionKey, days: Object.fromEntries(days.map((d) => [d, day])) };
}

/** Predictions `minutes` after `now`, all freshly read. */
export function preds(
  now: number,
  minutes: number[],
  directionKey = 'outbound',
  directionLabel = 'southbound',
  readAgoMin = 0.5,
  extra: Partial<Prediction> = {},
): Prediction[] {
  return minutes.map((m, i) => ({
    vehicleId: `${directionKey}-${i}`,
    directionKey,
    directionLabel,
    expectedArrival: at(now, m),
    timingRead: at(now, -readAgoMin),
    confirmed: true,
    terminatesHere: false,
    destination: null,
    platform: null,
    ...extra,
  }));
}

/** Arrivals every `gap` minutes, starting `first` minutes from now, up to `until` minutes. */
export function every(gap: number, until = 60, first = gap / 2): number[] {
  const out: number[] = [];
  for (let m = first; m <= until; m += gap) out.push(Math.round(m * 10) / 10);
  return out;
}

export const ok = (predictions: Prediction[]): StationArrivals => ({ ok: true, predictions });

export function station(
  name: string,
  arrivals: StationArrivals,
  directions: DirectionRef[] = [dirRef('outbound', 3)],
  stopId = `stop-${name.toLowerCase().replace(/\W+/g, '-')}`,
): CheckStation {
  return { stopId, name, directions, arrivals };
}

export function status(description: string, opts: Partial<StatusInput> = {}): StatusInput {
  return { description, validityPeriods: [], affectedStopIds: [], reason: null, ...opts };
}

export function line(statuses: StatusInput[], stations: CheckStation[], mode: Mode = 'tube'): LineInput {
  return { lineId: 'victoria', lineName: 'Victoria', mode, statuses, stations };
}

/** Two check stations with the same regular service: the usual "all is well" baseline. */
export function regularLine(now: number, statuses: StatusInput[], gap = 3, normal = 3): LineInput {
  return line(statuses, [
    station('Euston', ok(preds(now, every(gap))), [dirRef('outbound', normal)]),
    station('Brixton', ok(preds(now, every(gap))), [dirRef('outbound', normal)]),
  ]);
}
