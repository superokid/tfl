/**
 * Timetables from TfL's journey planner for lines whose `/Timetable` is 404 (Elizabeth line, Overground;
 * ADR-018). Pure: the paging and calls live in scripts/build-reference.ts. Inputs are `unknown` and checked
 * field by field, so a shape change gives no reference (fallback gap), never a crash.
 */
import { JOURNEYS } from '../config';
import type { Weekday } from '../rules/types';
import { serviceDayFrom } from './derive';
import type { DirectionFile } from './types';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export interface JourneyPage {
  /** Minutes from the sampled day's midnight, London wall clock (≥ 1440 after midnight). */
  departures: number[];
  /** Where the next page starts (TfL's "later" link), or null. */
  next: { date: string; time: string } | null;
}

const dayNumber = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))) / 86_400_000;

/** "2026-11-18T00:31:00" on sampled day "20261117" → 1471. */
function minutesFrom(day: string, iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return (dayNumber(`${m[1]}${m[2]}${m[3]}`) - dayNumber(day)) * 1440 + Number(m[4]) * 60 + Number(m[5]);
}

/** Direct journeys on `lineId` leaving `stopId`: one per train. Walks, changes and other lines are ignored. */
export function journeyPage(body: unknown, lineId: string, stopId: string, day: string): JourneyPage {
  if (!isObj(body)) return { departures: [], next: null };
  const departures: number[] = [];
  for (const j of arr(body.journeys)) {
    const legs = isObj(j) ? arr(j.legs) : [];
    const leg = legs[0];
    if (legs.length !== 1 || !isObj(leg)) continue;
    const onLine = arr(leg.routeOptions).some((o) => isObj(o) && isObj(o.lineIdentifier) && o.lineIdentifier.id === lineId);
    const from = isObj(leg.departurePoint) ? str(leg.departurePoint.naptanId) : null;
    const at = str(leg.departureTime);
    const min = at ? minutesFrom(day, at) : null;
    if (onLine && from === stopId && min !== null) departures.push(min);
  }
  const later = isObj(body.searchCriteria) && isObj(body.searchCriteria.timeAdjustments) ? body.searchCriteria.timeAdjustments.later : null;
  const date = isObj(later) ? str(later.date) : null;
  const time = isObj(later) ? str(later.time) : null;
  const next = date && time && /^\d{8}$/.test(date) && /^\d{4}$/.test(time) ? { date, time } : null;
  return { departures: departures.sort((a, b) => a - b), next };
}

/** A page's "later" link as minutes from the sampled day's midnight. */
export const pageMinutes = (day: string, next: { date: string; time: string }) =>
  (dayNumber(next.date) - dayNumber(day)) * 1440 + Number(next.time.slice(0, 2)) * 60 + Number(next.time.slice(2));

/**
 * Where to plan journeys to from `stopId`, in the direction of `sequence` (TfL's route sequence): each
 * route's next station sees every train that stops there; the furthest station all routes share, and each
 * route's last station, also see trains that skip it (Elizabeth line: 4 an hour run past West Ealing, all
 * reach Hayes & Harlington; eastbound most skip Acton Main Line, then split for Paddington or the tunnel).
 */
export function journeyTargets(sequence: unknown, stopId: string): string[] {
  const routes = isObj(sequence)
    ? arr(sequence.orderedLineRoutes).map((r) => (isObj(r) ? arr(r.naptanIds).map(str).filter((x): x is string => !!x) : []))
    : [];
  const tails = routes.map((r) => r.slice(r.indexOf(stopId) + 1)).filter((t, i) => routes[i]!.includes(stopId) && t.length > 0);
  if (tails.length === 0) return [];
  const nexts = tails.map((t) => t[0]!);
  const shared = tails[0]!.filter((id) => tails.every((t) => t.includes(id)));
  return [...new Set([...nexts, ...shared.slice(-1), ...tails.map((t) => t[t.length - 1]!)])];
}

const ymd = (dayNum: number) => new Date(dayNum * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');

/**
 * Days to sample, from `today` (YYYY-MM-DD, London): a Tuesday for Mon–Thu, a Friday (Night Overground),
 * a Saturday and a Sunday, each at least `daysAhead` away, and the same day a week later as a fallback.
 */
export function sampleDays(today: string): { weekdays: Weekday[]; dates: [string, string] }[] {
  const t = dayNumber(today.replace(/-/g, ''));
  const groups: { day: Weekday; weekdays: Weekday[] }[] = [
    { day: 2, weekdays: [1, 2, 3, 4] },
    { day: 5, weekdays: [5] },
    { day: 6, weekdays: [6] },
    { day: 0, weekdays: [0] },
  ];
  return groups.map(({ day, weekdays }) => {
    let d = t + JOURNEYS.daysAhead;
    while (new Date(d * 86_400_000).getUTCDay() !== day) d++;
    return { weekdays, dates: [ymd(d), ymd(d + 7)] };
  });
}

/**
 * Departures per sampled day → a direction file, as from a TfL timetable. Null if any day has too few
 * trains (closures, replacement buses, no data): no reference beats a false "closed" that day.
 */
export function directionFromDepartures(
  groups: { weekdays: Weekday[]; departures: number[] }[],
  directionKey: 'inbound' | 'outbound',
): DirectionFile | null {
  const serviceDays: DirectionFile['serviceDays'] = [];
  const weekdays: DirectionFile['weekdays'] = [-1, -1, -1, -1, -1, -1, -1];
  for (const g of groups) {
    if (new Set(g.departures).size < JOURNEYS.minDeparturesPerDay) return null;
    const day = serviceDayFrom(g.departures);
    if (!day) return null;
    const key = JSON.stringify(day);
    let idx = serviceDays.findIndex((x) => JSON.stringify(x) === key);
    if (idx === -1) idx = serviceDays.push(day) - 1;
    for (const w of g.weekdays) weekdays[w] = idx;
  }
  return weekdays.every((w) => w >= 0) ? { directionKey, serviceDays, weekdays } : null;
}
