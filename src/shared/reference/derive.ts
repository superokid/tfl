/**
 * Pure derivations from raw TfL responses to reference data (ADR-007). Inputs are `unknown`: every
 * field is checked, so a TfL shape change degrades to "no reference" (fallback gap), never a crash.
 */
import type { ServiceBand, ServiceDay, Weekday } from '../rules/types';
import type { DirectionFile } from './types';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function cleanStationName(name: string): string {
  return name
    .replace(/\s+(Underground|DLR|Rail|Overground|Elizabeth line)?\s*Station$/i, '')
    .replace(/\s+Tram Stop$/i, '')
    .replace(/\s+\(.*?\)\s*$/, '')
    .trim();
}

export interface Pick {
  stopId: string;
  name: string;
}

/**
 * SPEC §4.3: 2 stations served by all (or most, weighted by route length) routes, away from the ends,
 * spread apart, interchanges preferred. Short lines may use stations nearer the ends.
 */
export function pickCheckStations(sequence: unknown): Pick[] {
  if (!isObj(sequence)) return [];
  const routes = arr(sequence.orderedLineRoutes)
    .map((r) => (isObj(r) ? arr(r.naptanIds).map(str).filter((x): x is string => !!x) : []))
    .filter((r) => r.length > 0);
  if (routes.length === 0) return [];

  const info = new Map<string, { name: string; lines: number }>();
  for (const seq of arr(sequence.stopPointSequences)) {
    if (!isObj(seq)) continue;
    for (const p of arr(seq.stopPoint)) {
      if (!isObj(p)) continue;
      const id = str(p.id);
      if (id) info.set(id, { name: cleanStationName(str(p.name) ?? id), lines: arr(p.lines).length });
    }
  }

  // Coverage = total length of the routes serving a stop, so long main routes outweigh short shuttles
  // (District: Upminster routes vs Edgware Road shuttles).
  const routeCount = new Map<string, number>();
  for (const r of routes) for (const id of new Set(r)) routeCount.set(id, (routeCount.get(id) ?? 0) + r.length);

  const margin = (len: number) => (len >= 7 ? 2 : len >= 4 ? 1 : 0);
  const awayFromEnds = (id: string) =>
    routes.every((r) => {
      const i = r.indexOf(id);
      return i === -1 || (i >= margin(r.length) && i <= r.length - 1 - margin(r.length));
    });

  const ranked = [...routeCount.keys()]
    .filter(awayFromEnds)
    .sort(
      (a, b) =>
        (routeCount.get(b) ?? 0) - (routeCount.get(a) ?? 0) ||
        (info.get(b)?.lines ?? 0) - (info.get(a)?.lines ?? 0) ||
        a.localeCompare(b),
    );
  const ids = ranked.length >= 2 ? ranked : [...routeCount.keys()];
  if (ids.length < 2) return ids.map((id) => ({ stopId: id, name: info.get(id)?.name ?? id }));

  // Among the best-served candidates, take the pair furthest apart on the longest route containing both.
  const best = routeCount.get(ids[0]!) ?? 0;
  let pool = ids.filter((id) => (routeCount.get(id) ?? 0) === best);
  if (pool.length < 2) pool = ids.slice(0, Math.min(ids.length, 8));
  pool = pool.slice(0, 16);

  let pair: [string, string] = [pool[0]!, pool[1]!];
  let bestScore = -1;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i]!;
      const b = pool[j]!;
      const distance = Math.max(
        0,
        ...routes.map((r) => (r.includes(a) && r.includes(b) ? Math.abs(r.indexOf(a) - r.indexOf(b)) : 0)),
      );
      const score = distance * 10 + Math.min(info.get(a)?.lines ?? 1, info.get(b)?.lines ?? 1);
      if (score > bestScore) {
        bestScore = score;
        pair = [a, b];
      }
    }
  }
  return pair.map((id) => ({ stopId: id, name: info.get(id)?.name ?? id }));
}

const DAY_INDEX: Record<string, Weekday> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/** "Monday - Thursday" → [1,2,3,4]; "Saturday (also Good Friday)" → [6]. Parenthesised notes are ignored. */
export function scheduleWeekdays(name: string): Weekday[] {
  const core = name.replace(/\(.*?\)/g, '').toLowerCase();
  const range = /(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*(?:-|–|to)\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/.exec(core);
  if (range) {
    const from = DAY_INDEX[range[1]!]!;
    const to = DAY_INDEX[range[2]!]!;
    const out: Weekday[] = [];
    for (let d = from; ; d = ((d + 1) % 7) as Weekday) {
      out.push(d);
      if (d === to || out.length > 7) break;
    }
    return out;
  }
  return Object.entries(DAY_INDEX)
    .filter(([day]) => new RegExp(`\\b${day}\\b`).test(core))
    .map(([, i]) => i);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const half = (x: number) => Math.round(x * 2) / 2;

/** Departures (minutes since service-day midnight) → service day with hourly median-gap bands, merged. */
export function serviceDayFrom(departures: number[]): ServiceDay | null {
  const d = [...new Set(departures)].sort((a, b) => a - b);
  if (d.length < 2) return null;
  const byHour = new Map<number, number[]>();
  for (let i = 0; i < d.length - 1; i++) {
    const h = Math.floor(d[i]! / 60);
    byHour.set(h, [...(byHour.get(h) ?? []), d[i + 1]! - d[i]!]);
  }
  const bands: ServiceBand[] = [];
  for (const h of [...byHour.keys()].sort((a, b) => a - b)) {
    const gap = half(median(byHour.get(h)!));
    const last = bands[bands.length - 1];
    if (last && last.toMin === h * 60 && last.normalGapMin === gap) last.toMin = (h + 1) * 60;
    else bands.push({ fromMin: h * 60, toMin: (h + 1) * 60, normalGapMin: gap });
  }
  return { firstMin: d[0]!, lastMin: d[d.length - 1]!, bands };
}

/** A timetable response (departures from one stop, one direction) → compact direction reference. */
export function directionFromTimetable(body: unknown, directionKey: 'inbound' | 'outbound'): DirectionFile | null {
  if (!isObj(body) || !isObj(body.timetable)) return null;
  const departuresBySchedule = new Map<string, number[]>();
  for (const route of arr(body.timetable.routes)) {
    if (!isObj(route)) continue;
    for (const s of arr(route.schedules)) {
      if (!isObj(s)) continue;
      const name = str(s.name);
      if (!name) continue;
      const mins = arr(s.knownJourneys)
        .map((j) => (isObj(j) ? Number(j.hour) * 60 + Number(j.minute) : NaN))
        .filter(Number.isFinite);
      departuresBySchedule.set(name, [...(departuresBySchedule.get(name) ?? []), ...mins]);
    }
  }

  const serviceDays: ServiceDay[] = [];
  const weekdays: DirectionFile['weekdays'] = [-1, -1, -1, -1, -1, -1, -1];
  for (const [name, mins] of departuresBySchedule) {
    const day = serviceDayFrom(mins);
    const days = scheduleWeekdays(name);
    if (!day || days.length === 0) continue;
    const key = JSON.stringify(day);
    let idx = serviceDays.findIndex((x) => JSON.stringify(x) === key);
    if (idx === -1) idx = serviceDays.push(day) - 1;
    for (const w of days) weekdays[w] = idx;
  }
  return serviceDays.length > 0 ? { directionKey, serviceDays, weekdays } : null;
}

/** Learns "northbound" → "outbound" from arrivals that carry both a direction and a platform name. */
export function learnBoundDirections(arrivals: unknown): Record<string, 'inbound' | 'outbound'> {
  const votes = new Map<string, { inbound: number; outbound: number }>();
  for (const a of arr(arrivals)) {
    if (!isObj(a)) continue;
    const dir = str(a.direction);
    const bound = boundWord(str(a.platformName) ?? '');
    if ((dir !== 'inbound' && dir !== 'outbound') || !bound) continue;
    const v = votes.get(bound) ?? { inbound: 0, outbound: 0 };
    v[dir]++;
    votes.set(bound, v);
  }
  const out: Record<string, 'inbound' | 'outbound'> = {};
  for (const [bound, v] of votes) if (v.inbound !== v.outbound) out[bound] = v.inbound > v.outbound ? 'inbound' : 'outbound';
  return out;
}

/** "Northbound - Platform 4" → "northbound"; "Inner Rail - Platform 1" → "inner rail"; "Platform 2" → null. */
export function boundWord(platformName: string): string | null {
  const m = /\b(north|south|east|west)bound\b|\b(inner|outer) rail\b/i.exec(platformName);
  return m ? m[0].toLowerCase() : null;
}
