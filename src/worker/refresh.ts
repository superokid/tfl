/**
 * One refresh: TfL → verdicts for every rail line (SPEC §4.1 step 6–8). Throws TflError only when the
 * status call fails (nothing to judge); per-stop failures degrade those lines only.
 */
import type { Snapshot } from '../shared/api';
import { LIVE } from '../shared/config';
import { expandDirection } from '../shared/reference/load';
import type { ReferenceFile } from '../shared/reference/types';
import { mapStatus } from '../shared/rules/status';
import type { ArrivalsFailure, LineInput, LineVerdict, Prediction, StationArrivals } from '../shared/rules/types';
import { judgeLine } from '../shared/rules/verdict';
import { TflError, type TflClient } from './tfl/client';
import { parseArrivals, parseStatuses } from './tfl/parse';

export async function buildSnapshot(
  tfl: TflClient,
  reference: ReferenceFile,
  now: number,
  previous: Snapshot | null,
): Promise<Snapshot> {
  const modes = [...new Set(reference.lines.map((l) => l.mode))].join(',');
  const statuses = parseStatuses(await tfl.getJson(`/Line/Mode/${modes}/Status`));

  // Affected stops only exist with ?detail=true: ask for the lines that need them.
  const partialLines = [...statuses].filter(([, ss]) => ss.some((s) => mapStatus(s.description) === 'PARTIAL')).map(([id]) => id);
  if (partialLines.length > 0) {
    try {
      const detail = parseStatuses(await tfl.getJson(`/Line/${partialLines.join(',')}/Status`, { detail: 'true' }));
      for (const [id, ss] of detail) statuses.set(id, ss);
    } catch {
      // Without affected stops, partial statuses are CANT_VERIFY (partial-unlocated). Nothing else changes.
    }
  }

  // One arrivals call per check stop, covering every judged line that stops there.
  const judged = reference.lines.filter((l) => !l.statusOnly);
  const linesAtStop = new Map<string, string[]>();
  for (const l of judged) for (const s of l.stations) linesAtStop.set(s.stopId, [...(linesAtStop.get(s.stopId) ?? []), l.lineId]);
  const bound = Object.fromEntries(reference.lines.map((l) => [l.lineId, l.boundDirections]));

  const callsLeft = LIVE.maxCallsPerRefresh - tfl.calls;
  const stops = [...linesAtStop.keys()];
  const arrivalsByStop = new Map<string, Map<string, Prediction[]> | ArrivalsFailure>();
  await Promise.all(
    stops.map(async (stopId, i) => {
      if (i >= callsLeft) return arrivalsByStop.set(stopId, 'budget');
      try {
        const body = await tfl.getJson(`/Line/${linesAtStop.get(stopId)!.join(',')}/Arrivals/${stopId}`);
        arrivalsByStop.set(stopId, parseArrivals(body, stopId, bound));
      } catch (err) {
        arrivalsByStop.set(stopId, err instanceof TflError && err.kind === 'invalid' ? 'invalid' : 'failed');
      }
    }),
  );

  const previousById = new Map(previous?.lines.map((l) => [l.lineId, l]));
  const lines: LineVerdict[] = reference.lines.map((ref) => {
    const input: LineInput = {
      lineId: ref.lineId,
      lineName: ref.lineName,
      mode: ref.mode,
      statuses: statuses.get(ref.lineId) ?? [],
      stations: ref.statusOnly
        ? []
        : ref.stations.map((s) => {
            const a = arrivalsByStop.get(s.stopId);
            const arrivals: StationArrivals =
              a === undefined || typeof a === 'string'
                ? { ok: false, failure: a ?? 'failed' }
                : { ok: true, predictions: a.get(ref.lineId) ?? [] };
            return { stopId: s.stopId, name: s.name, directions: s.directions.map(expandDirection), arrivals };
          }),
    };
    const verdict = judgeLine(input, now);

    // A failed arrivals call shouldn't blank a line that was judged moments ago.
    const callFailed = input.stations.some((s) => !s.arrivals.ok);
    const prev = previousById.get(ref.lineId);
    if (callFailed && verdict.verdict === 'CANT_VERIFY' && prev && now - prev.checkedAt < LIVE.reuseVerdictMs) return prev;
    return verdict;
  });

  return { checkedAt: now, referenceGeneratedAt: reference.generatedAt, lines };
}
