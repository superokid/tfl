/**
 * Builders for what each screen needs (ADR-011: fetch what the user asked for, nothing more):
 * - buildLinesSnapshot: TfL statuses for every rail line (home screen), 1–2 TfL calls.
 * - buildLineReport: one line's live check + next trains (line screen): its check stops, plus 1 for the
 *   status unless the home screen's stored statuses are recent enough.
 * - buildSnapshot: every line's live check (the "Check all lines" button), ~42 calls.
 * Each throws TflError only when the status call fails; arrivals failures degrade the affected line only.
 * Status and arrivals calls go out together: TfL often takes 1–3 s per call, so chaining them doubled
 * the wait.
 */
import {
  LINES_VERSION,
  SNAPSHOT_VERSION,
  type LineReport,
  type LinesSnapshot,
  type LineStatus,
  type Snapshot,
} from '../shared/api';
import { buildBoard, lineMessages } from '../shared/boards';
import { LIVE, OPENING } from '../shared/config';
import { expandDirection } from '../shared/reference/load';
import type { LineFile, ReferenceFile } from '../shared/reference/types';
import { nextFirstTrain, resumeTimeFromMessage, serviceAt } from '../shared/rules/hours';
import { activeStatuses, mapStatus } from '../shared/rules/status';
import type { ArrivalsFailure, Expected, LineInput, Prediction, StationArrivals, StatusInput } from '../shared/rules/types';
import { judgeLine } from '../shared/rules/verdict';
import { TflError, type TflClient } from './tfl/client';
import { parseArrivals, parseStatuses } from './tfl/parse';

type ArrivalsByStop = Map<string, Map<string, Prediction[]> | ArrivalsFailure>;

const modesOf = (reference: ReferenceFile) => [...new Set(reference.lines.map((l) => l.mode))].join(',');

/** Statuses for the given lines; partial statuses get their affected stops via ?detail=true. */
async function fetchStatuses(tfl: TflClient, path: string): Promise<Map<string, StatusInput[]>> {
  const statuses = parseStatuses(await tfl.getJson(path));
  const partialLines = [...statuses].filter(([, ss]) => ss.some((s) => mapStatus(s.description) === 'PARTIAL')).map(([id]) => id);
  if (partialLines.length > 0) {
    try {
      const detail = parseStatuses(await tfl.getJson(`/Line/${partialLines.join(',')}/Status`, { detail: 'true' }));
      for (const [id, ss] of detail) statuses.set(id, ss);
    } catch {
      // Without affected stops, partial statuses are CANT_VERIFY (partial-unlocated). Nothing else changes.
    }
  }
  return statuses;
}

/** One arrivals call per stop, covering every listed line that stops there. */
async function fetchArrivals(tfl: TflClient, reference: ReferenceFile, lines: LineFile[]): Promise<ArrivalsByStop> {
  const linesAtStop = new Map<string, string[]>();
  for (const l of lines) for (const s of l.stations) linesAtStop.set(s.stopId, [...(linesAtStop.get(s.stopId) ?? []), l.lineId]);
  const bound = Object.fromEntries(reference.lines.map((l) => [l.lineId, l.boundDirections]));
  // Status + detail run alongside, so their 2 calls are reserved up front.
  const callsLeft = LIVE.maxCallsPerRefresh - 2;
  const out: ArrivalsByStop = new Map();
  await Promise.all(
    [...linesAtStop.keys()].map(async (stopId, i) => {
      if (i >= callsLeft) return out.set(stopId, 'budget');
      try {
        const body = await tfl.getJson(`/Line/${linesAtStop.get(stopId)!.join(',')}/Arrivals/${stopId}`);
        out.set(stopId, parseArrivals(body, stopId, bound));
      } catch (err) {
        out.set(stopId, err instanceof TflError && err.kind === 'invalid' ? 'invalid' : 'failed');
      }
    }),
  );
  return out;
}

/**
 * Closed outside its hours (night, or a day it doesn't run), and when it opens: TfL's own time if its
 * message gives one, else the first timetabled train at the check stations. A daytime closure is neither.
 */
function opening(ref: LineFile, severity: Expected | null, messages: string[], now: number): { offHours: boolean; opensAt: number | null } {
  if (severity !== 'CLOSED') return { offHours: false, opensAt: null };
  const refs = ref.stations.flatMap((s) => s.directions.map(expandDirection));
  const timetableClosed = refs.length > 0 && refs.every((r) => serviceAt(r, now).kind === 'outside');
  // TfL's nightly message; also covers lines with no timetable, and a timetable whose last trams run late.
  const resumes = messages.some((m) => /\bservice will resume\b/i.test(m));
  if (!timetableClosed && !resumes) return { offHours: false, opensAt: null };
  const told = messages.map((m) => resumeTimeFromMessage(m, now)).find((t) => t !== null) ?? null;
  if (told !== null) return { offHours: true, opensAt: told };
  const first = timetableClosed ? nextFirstTrain(refs, now) : null;
  const thisMorning = messages.some((m) => /\blater (?:this morning|today)\b/i.test(m));
  const plausible = first !== null && !(thisMorning && first - now > OPENING.thisMorningMaxMs);
  return { offHours: true, opensAt: plausible ? first : null };
}

/** The rules engine for one line, plus TfL's messages and live boards. */
function report(ref: LineFile, statuses: StatusInput[], arrivals: ArrivalsByStop, now: number): LineReport {
  const input: LineInput = {
    lineId: ref.lineId,
    lineName: ref.lineName,
    mode: ref.mode,
    statuses,
    stations: ref.statusOnly
      ? []
      : ref.stations.map((s) => {
          const a = arrivals.get(s.stopId);
          const st: StationArrivals =
            a === undefined || typeof a === 'string'
              ? { ok: false, failure: a ?? 'failed' }
              : { ok: true, predictions: a.get(ref.lineId) ?? [] };
          return { stopId: s.stopId, name: s.name, directions: s.directions.map(expandDirection), arrivals: st };
        }),
  };
  const verdict = judgeLine(input, now);
  const messages = lineMessages(ref.lineName, activeStatuses(statuses, now).map((s) => s.reason));
  const boards = input.stations.map((s) => ({
    ...buildBoard(s.stopId, s.name, s.arrivals.ok ? s.arrivals.predictions : null, now, 6),
    firstTrainAt: nextFirstTrain(s.directions, now),
  }));
  return { ...verdict, messages, boards, ...opening(ref, severityOf(activeStatuses(statuses, now)), messages, now) };
}

/** Display order, mildest first: a part suspension is worse than severe delays (as TfL's severities). */
const DISPLAY_ORDER: Expected[] = ['NORMAL', 'MINOR', 'DEGRADED', 'PARTIAL', 'NONE', 'CLOSED'];

/** How bad TfL says the line is, for sorting and colour: null if a status isn't recognised. */
function severityOf(statuses: StatusInput[]): Expected | null {
  const mapped = statuses.map((s) => mapStatus(s.description));
  if (mapped.length === 0 || mapped.includes(null)) return null;
  return (mapped as Expected[]).reduce((worst, e) => (DISPLAY_ORDER.indexOf(e) > DISPLAY_ORDER.indexOf(worst) ? e : worst), 'NORMAL');
}

/** Home screen: statuses only. */
export async function buildLinesSnapshot(tfl: TflClient, reference: ReferenceFile, now: number): Promise<LinesSnapshot> {
  const statuses = await fetchStatuses(tfl, `/Line/Mode/${modesOf(reference)}/Status`);
  const lines: LineStatus[] = reference.lines.map((ref) => {
    const active = activeStatuses(statuses.get(ref.lineId) ?? [], now);
    const severity = severityOf(active);
    const messages = lineMessages(ref.lineName, active.map((s) => s.reason));
    return {
      lineId: ref.lineId,
      lineName: ref.lineName,
      mode: ref.mode,
      tflSays: [...new Set(active.map((s) => s.description))].join(', '),
      severity,
      messages,
      checkable: !ref.statusOnly,
      ...opening(ref, severity, messages, now),
    };
  });
  const kept = Object.fromEntries(reference.lines.map((ref) => [ref.lineId, statuses.get(ref.lineId) ?? []]));
  return { version: LINES_VERSION, checkedAt: now, referenceGeneratedAt: reference.generatedAt, lines, statuses: kept };
}

/**
 * Line screen: one line's status, live check and next trains. `knownStatuses` gives the line's statuses
 * when they are already at hand (null: fetch them from TfL); it is looked up alongside the arrivals calls.
 */
export async function buildLineReport(
  tfl: TflClient,
  reference: ReferenceFile,
  lineId: string,
  now: number,
  knownStatuses: () => Promise<StatusInput[] | null> = async () => null,
): Promise<LineReport | null> {
  const ref = reference.lines.find((l) => l.lineId === lineId);
  if (!ref) return null;
  const [statuses, arrivals] = await Promise.all([
    knownStatuses().then(async (known) => known ?? (await fetchStatuses(tfl, `/Line/${ref.lineId}/Status`)).get(ref.lineId) ?? []),
    ref.statusOnly ? new Map() : fetchArrivals(tfl, reference, [ref]),
  ]);
  return report(ref, statuses, arrivals, now);
}

/** "Check all lines": every line's live check (the original full comparison). */
export async function buildSnapshot(
  tfl: TflClient,
  reference: ReferenceFile,
  now: number,
  previous: Snapshot | null,
): Promise<Snapshot> {
  const [statuses, arrivals] = await Promise.all([
    fetchStatuses(tfl, `/Line/Mode/${modesOf(reference)}/Status`),
    fetchArrivals(tfl, reference, reference.lines.filter((l) => !l.statusOnly)),
  ]);
  const previousById = new Map(previous?.lines.map((l) => [l.lineId, l]));
  const lines = reference.lines.map((ref) => {
    const r = report(ref, statuses.get(ref.lineId) ?? [], arrivals, now);
    // A failed arrivals call shouldn't blank a line that was judged moments ago.
    const callFailed = ref.stations.some((s) => typeof arrivals.get(s.stopId) === 'string');
    const prev = previousById.get(ref.lineId);
    if (callFailed && r.verdict === 'CANT_VERIFY' && prev && now - prev.checkedAt < LIVE.reuseVerdictMs) {
      return { ...prev, messages: r.messages };
    }
    return r;
  });
  return { version: SNAPSHOT_VERSION, checkedAt: now, referenceGeneratedAt: reference.generatedAt, lines };
}
