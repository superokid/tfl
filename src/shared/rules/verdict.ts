/**
 * The rules engine (SPEC §5): a pure function of (line input, now) → verdict with evidence.
 * No I/O, no Date.now(). Mismatches need ≥ 2 agreeing stations and real (non-fallback) normal gaps.
 */
import { FALLBACK_NORMAL_GAP_MIN, RULES, VEHICLE_NOUN } from '../config';
import { analyseDirection, thresholdFor } from './gaps';
import { londonClock } from './london';
import { activeStatuses, mapStatus, mostRestrictive } from './status';
import type {
  CheckStation,
  DirectionEvidence,
  DirectionRef,
  Expected,
  LineInput,
  LineVerdict,
  VerdictKind,
  VerdictReason,
  Weekday,
} from './types';

type Ranked = Exclude<Expected, 'PARTIAL'>;
type ServiceState = { kind: 'in'; normalGapMin: number | null } | { kind: 'outside' } | { kind: 'edge' };

/** Is this direction in service now? Checks today's service day and yesterday's after-midnight tail. */
function serviceAt(ref: DirectionRef, now: number): ServiceState {
  const { weekday, minutes } = londonClock(now);
  const yesterday = ((weekday + 6) % 7) as Weekday;
  const candidates = [
    { day: ref.days[weekday], t: minutes },
    { day: ref.days[yesterday], t: minutes + 1440 },
  ];
  for (const { day, t } of candidates) {
    if (!day || t < day.firstMin || t > day.lastMin) continue;
    if (t - day.firstMin < RULES.dayEdgeMin || day.lastMin - t < RULES.dayEdgeMin) return { kind: 'edge' };
    const band = day.bands.find((b) => b.fromMin <= t && t < b.toMin);
    return { kind: 'in', normalGapMin: band?.normalGapMin ?? null };
  }
  return { kind: 'outside' };
}

function stationEvidence(s: CheckStation, line: LineInput, now: number): DirectionEvidence[] {
  const fallbackGap = FALLBACK_NORMAL_GAP_MIN[line.mode];
  const predictions = s.arrivals.ok ? s.arrivals.predictions : [];
  const keys = [...new Set([...s.directions.map((d) => d.directionKey), ...predictions.map((p) => p.directionKey)])];
  if (keys.length === 0) keys.push('*'); // failed call and no timetable: one placeholder row

  return keys.map((key) => {
    const ref = s.directions.find((d) => d.directionKey === key);
    const own = predictions.filter((p) => p.directionKey === key);
    const service: ServiceState = ref ? serviceAt(ref, now) : { kind: 'in', normalGapMin: null };
    const normalGapMin = (service.kind === 'in' ? service.normalGapMin : null) ?? fallbackGap;
    const base = {
      stopId: s.stopId,
      stationName: s.name,
      directionKey: key,
      directionLabel: own[0]?.directionLabel ?? (key === '*' ? 'all directions' : key),
      normalGapMin,
      normalGapIsFallback: !(service.kind === 'in' && service.normalGapMin !== null),
      thresholdMin: thresholdFor(normalGapMin),
    };
    const unusable = (issue: DirectionEvidence['issue']): DirectionEvidence => ({
      ...base,
      observedGapMin: null,
      gapKind: null,
      horizonMin: null,
      usable: false,
      issue,
    });

    if (service.kind === 'outside') return unusable('outside-hours');
    if (service.kind === 'edge') return unusable('day-edge');
    if (!s.arrivals.ok) return unusable(s.arrivals.failure);
    const a = analyseDirection(own, now, normalGapMin);
    return { ...base, ...a };
  });
}

interface StationView {
  station: CheckStation;
  expected: Ranked;
  evidence: DirectionEvidence[];
}

const usableOf = (v: StationView) => v.evidence.filter((e) => e.usable);
const gap = (e: DirectionEvidence) => e.observedGapMin ?? 0;

/** Over-threshold somewhere; `strict` = only directions with a real (timetable) normal gap count. */
function isOver(v: StationView, strict: boolean): boolean {
  return usableOf(v).some((e) => gap(e) > e.thresholdMin && (!strict || !e.normalGapIsFallback));
}

/** Every usable direction at or under `limit(e)`; `strict` additionally rules out fallback gaps. */
function allUnder(v: StationView, limit: (e: DirectionEvidence) => number, strict: boolean): boolean {
  const u = usableOf(v);
  return u.length > 0 && u.every((e) => gap(e) <= limit(e) && (!strict || !e.normalGapIsFallback));
}

const plural = (noun: string) => (noun.endsWith('s') ? `${noun}es` : `${noun}s`);
const names = (views: StationView[]) =>
  views
    .slice(0, 2)
    .map((v) => v.station.name)
    .join(' and ');

export function judgeLine(line: LineInput, now: number): LineVerdict {
  const active = activeStatuses(line.statuses, now);
  const tflSays = [...new Set(active.map((s) => s.description))].join(', ');
  const noun = VEHICLE_NOUN[line.mode];
  const verdict = (
    kind: VerdictKind,
    reason: VerdictReason | null,
    summary: string,
    evidence: DirectionEvidence[] = [],
  ): LineVerdict => ({
    lineId: line.lineId,
    lineName: line.lineName,
    mode: line.mode,
    verdict: kind,
    reason,
    tflSays,
    summary,
    evidence,
    checkedAt: now,
  });

  // 1. What does TfL say?
  if (active.length === 0) {
    return verdict('CANT_VERIFY', 'unknown-status', "TfL hasn't published a current status for this line.");
  }
  const mapped = active.map((s) => ({ status: s, expected: mapStatus(s.description) }));
  const unknown = mapped.find((m) => m.expected === null);
  if (unknown) {
    return verdict('CANT_VERIFY', 'unknown-status', `TfL reports "${unknown.status.description}", which isn't checked yet.`);
  }
  const partials = mapped.filter((m) => m.expected === 'PARTIAL').map((m) => m.status);
  const base = mostRestrictive(mapped.map((m) => m.expected).filter((e): e is Ranked => e !== null && e !== 'PARTIAL'));

  if (base === 'CLOSED') return verdict('CLOSED', 'planned-closure', `TfL reports ${tflSays}.`);
  if (line.stations.length === 0) {
    return verdict('CANT_VERIFY', 'status-only', "Live predictions aren't available for this line, so its status can't be checked.");
  }

  // 2. What is each check station expected to see? A partial status applies to its affected stops only.
  const affected = new Set(partials.flatMap((p) => p.affectedStopIds));
  const views: StationView[] = line.stations.map((station) => ({
    station,
    expected: partials.length > 0 && affected.has(station.stopId) ? 'NONE' : base,
    evidence: stationEvidence(station, line, now),
  }));
  const evidence = views.flatMap((v) => v.evidence);

  if (partials.length > 0 && !line.stations.some((s) => affected.has(s.stopId))) {
    return verdict('CANT_VERIFY', 'partial-unlocated', "TfL hasn't said which section is affected near our check stations, so this can't be checked.", evidence);
  }

  // 3. Outside hours everywhere → closed, never a mismatch.
  if (evidence.every((e) => e.issue === 'outside-hours')) {
    return verdict('CLOSED', 'outside-hours', 'Closed for the night.', evidence);
  }

  const usable = views.filter((v) => usableOf(v).length > 0);
  if (usable.length < RULES.minAgreeingStations) {
    return verdict('CANT_VERIFY', 'insufficient-data', 'Not enough live data to check this line right now.', evidence);
  }

  // 4. Mismatches: ≥ 2 stations agree, and only real normal gaps can raise one.
  const hidden = (strict: boolean) =>
    usable.filter((v) => (v.expected === 'NORMAL' || v.expected === 'MINOR') && isOver(v, strict));
  const stale = (strict: boolean) =>
    usable.filter(
      (v) =>
        (v.expected === 'NONE' && allUnder(v, (e) => e.thresholdMin, strict)) ||
        (v.expected === 'DEGRADED' && allUnder(v, (e) => RULES.degradedNormalMultiplier * e.normalGapMin, strict)),
    );

  const hiddenStrict = hidden(true);
  if (hiddenStrict.length >= RULES.minAgreeingStations) {
    const worst = hiddenStrict
      .flatMap(usableOf)
      .filter((e) => gap(e) > e.thresholdMin && !e.normalGapIsFallback)
      .reduce((a, b) => (gap(b) / b.normalGapMin > gap(a) / a.normalGapMin ? b : a));
    const mins = Math.round(gap(worst));
    const usual = Math.round(worst.normalGapMin);
    const what =
      worst.gapKind === 'next'
        ? `the next ${worst.directionLabel} ${noun} at ${worst.stationName} is ${mins} minutes away`
        : `there's a ${mins}-minute gap between ${worst.directionLabel} ${plural(noun)} at ${worst.stationName}`;
    return verdict('HIDDEN_DISRUPTION', null, `TfL says ${tflSays}, but ${what} (usually ${usual}).`, evidence);
  }

  const staleStrict = stale(true);
  if (staleStrict.length >= RULES.minAgreeingStations) {
    return verdict(
      'STALE_ALERT',
      null,
      `TfL says ${tflSays}, but ${plural(noun)} are running normally at ${names(staleStrict)}.`,
      evidence,
    );
  }

  if (hidden(false).length >= RULES.minAgreeingStations || stale(false).length >= RULES.minAgreeingStations) {
    return verdict(
      'CANT_VERIFY',
      'fallback-gap',
      "Services don't look like TfL's status, but there's no timetable to compare against, so this isn't flagged.",
      evidence,
    );
  }

  return verdict('MATCH', null, `${plural(noun)[0]!.toUpperCase()}${plural(noun).slice(1)} at ${names(usable)} are consistent with TfL's status.`, evidence);
}
