/** Live arrivals boards for the UI: next services per station and direction (display only, pure). */
import type { Prediction } from './rules/types';

export interface UpcomingArrival {
  /** Expected arrival (epoch ms). Absolute, so the UI can count down between refreshes. */
  at: number;
  destination: string | null;
  /** Ends its journey here (e.g. Jubilee trains arriving at Stratford). */
  terminates: boolean;
}

export interface DirectionBoard {
  key: string;
  /** "Southbound · Platform 1", "Platform 8 · towards Shenfield", or "Towards Abbey Wood". */
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
  // Group by physical platform when TfL names one: TfL's `direction` is sometimes wrong (Elizabeth line
  // at Stratford lists eastbound Gidea Park trains as outbound), and branch platforms stay apart.
  const upcoming = predictions.filter((p) => p.expectedArrival >= now - 30_000);
  const byKey = new Map<string, Prediction[]>();
  const add = (key: string, p: Prediction) => byKey.set(key, [...(byKey.get(key) ?? []), p]);
  for (const p of upcoming) if (p.platform) add(p.platform, p);
  // "Platform Unknown" (often far-future): join the platform serving the same destination; if the station
  // reports no platforms at all, group by direction; otherwise drop it rather than guess.
  for (const p of upcoming) {
    if (p.platform) continue;
    const match = [...byKey].find(([, ps]) => ps.some((q) => q.destination && q.destination === p.destination));
    if (match) add(match[0], p);
    else if (byKey.size === 0 || [...byKey.keys()].every((k) => k.startsWith('dir:'))) add(`dir:${p.directionKey}`, p);
  }
  // At a terminus, platforms full of arriving-to-terminate trains merge into one group per compass word.
  for (const [key, ps] of [...byKey]) {
    if (ps.length === 0 || !ps.every((p) => p.terminatesHere)) continue;
    byKey.delete(key);
    for (const p of ps) add(`term:${p.directionLabel}`, p);
  }
  const directions = [...byKey]
    .map(([key, ps]): DirectionBoard => {
      const earliest = new Map<string, Prediction>();
      for (const p of ps) {
        const seen = earliest.get(p.vehicleId);
        if (!seen || p.expectedArrival < seen.expectedArrival) earliest.set(p.vehicleId, p);
      }
      const sorted = [...earliest.values()].sort((a, b) => a.expectedArrival - b.expectedArrival);
      const compass = sorted.find((p) => p.directionLabel)?.directionLabel;
      const towards = mostCommon(sorted.filter((p) => !p.terminatesHere).map((p) => p.destination));
      const platform = sorted[0]?.platform ?? null;
      const platformNo = platform ? /platform\s*\S+/i.exec(platform)?.[0] : undefined;
      const label = key.startsWith('term:')
        ? compass
          ? `${capitalise(compass)} · trains terminating here`
          : 'Trains terminating here'
        : compass
        ? [capitalise(compass), platformNo ? capitalise(platformNo) : null].filter(Boolean).join(' · ')
        : platform
          ? [platform, towards ? `towards ${towards}` : null].filter(Boolean).join(' · ')
          : towards
            ? `Towards ${towards}`
            : 'Services';
      return {
        key,
        label,
        arrivals: sorted
          .slice(0, perDirection)
          .map((p) => ({ at: p.expectedArrival, destination: p.destination, terminates: p.terminatesHere })),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return { stopId, name, live: true, directions };
}

/** TfL's passenger messages for a line: de-duplicated, without the "Bakerloo Line:" prefix. */
export function lineMessages(lineName: string, reasons: (string | null)[]): string[] {
  const prefix = new RegExp(`^${lineName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( line)?:\\s*`, 'i');
  return [...new Set(reasons.filter((r): r is string => !!r).map((r) => r.replace(prefix, '').trim()))].filter(Boolean);
}

/**
 * A bus stop's boards → one row per route and destination, soonest first: what a passenger scans at a
 * stop. Times already gone (over 30 s ago) are dropped.
 */
export function busRows(
  lines: { lineId: string; lineName: string; board: StationBoard }[],
  now: number,
  perRow = 3,
): { routeId: string; routeName: string; destination: string | null; times: number[] }[] {
  const rows: { routeId: string; routeName: string; destination: string | null; times: number[] }[] = [];
  for (const { lineId, lineName, board } of lines) {
    const byDest = new Map<string, number[]>();
    for (const a of board.directions.flatMap((d) => d.arrivals)) {
      if (a.at <= now - 30_000) continue;
      const key = a.terminates ? 'Terminates here' : (a.destination ?? '');
      byDest.set(key, [...(byDest.get(key) ?? []), a.at]);
    }
    for (const [dest, times] of byDest) {
      rows.push({ routeId: lineId, routeName: lineName, destination: dest || null, times: times.sort((x, y) => x - y).slice(0, perRow) });
    }
  }
  return rows.sort((a, b) => a.times[0]! - b.times[0]! || a.routeName.localeCompare(b.routeName, 'en', { numeric: true }));
}
