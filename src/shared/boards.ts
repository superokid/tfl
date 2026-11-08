/** Live arrivals boards for the UI: next services per station and direction (display only, pure). */
import type { Prediction } from './rules/types';

export interface UpcomingArrival {
  /** Expected arrival (epoch ms). Absolute, so the UI can count down between refreshes. */
  at: number;
  destination: string | null;
}

export interface DirectionBoard {
  key: string;
  /** "Southbound", "Towards Abbey Wood", or the platform name. */
  label: string;
  arrivals: UpcomingArrival[];
}

export interface StationBoard {
  stopId: string;
  name: string;
  /** False when TfL's arrivals call failed: the UI says so instead of showing an empty board. */
  live: boolean;
  directions: DirectionBoard[];
}

const capitalise = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function buildBoard(
  stopId: string,
  name: string,
  predictions: Prediction[] | null,
  now: number,
  perDirection = 4,
): StationBoard {
  if (predictions === null) return { stopId, name, live: false, directions: [] };
  const byKey = new Map<string, Prediction[]>();
  for (const p of predictions) {
    if (p.expectedArrival < now - 30_000) continue;
    byKey.set(p.directionKey, [...(byKey.get(p.directionKey) ?? []), p]);
  }
  const directions = [...byKey]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, ps]): DirectionBoard => {
      const earliest = new Map<string, Prediction>();
      for (const p of ps) {
        const seen = earliest.get(p.vehicleId);
        if (!seen || p.expectedArrival < seen.expectedArrival) earliest.set(p.vehicleId, p);
      }
      const sorted = [...earliest.values()].sort((a, b) => a.expectedArrival - b.expectedArrival);
      const compass = sorted.find((p) => p.directionLabel)?.directionLabel;
      const towards = mostCommon(sorted.map((p) => p.destination));
      const label = compass
        ? capitalise(compass)
        : towards
          ? `Towards ${towards}`
          : key.startsWith('platform:')
            ? key.slice(9)
            : 'Services';
      return {
        key,
        label,
        arrivals: sorted.slice(0, perDirection).map((p) => ({ at: p.expectedArrival, destination: p.destination })),
      };
    });
  return { stopId, name, live: true, directions };
}

/** TfL's passenger messages for a line: de-duplicated, without the "Bakerloo Line:" prefix. */
export function lineMessages(lineName: string, reasons: (string | null)[]): string[] {
  const prefix = new RegExp(`^${lineName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( line)?:\\s*`, 'i');
  return [...new Set(reasons.filter((r): r is string => !!r).map((r) => r.replace(prefix, '').trim()))].filter(Boolean);
}
