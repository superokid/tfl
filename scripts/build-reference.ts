/**
 * Builds src/shared/reference/rail.json from the live TfL API (ADR-007).
 *   bun run reference
 * Re-run when TfL changes timetables or lines. ~150 calls, 6 at a time, well under 500/min, plus several
 * thousand journey planner pages for lines with no TfL timetable (ADR-018): ~30–45 min in all.
 */
import { writeFileSync } from 'node:fs';
import { JOURNEYS, type Mode } from '../src/shared/config.ts';
import { createLimiter } from '../src/shared/limit.ts';
import { collectStations, directionFromTimetable, learnBoundDirections, pickCheckStations } from '../src/shared/reference/derive.ts';
import { directionFromDepartures, journeyPage, journeyTargets, pageMinutes, sampleDays } from '../src/shared/reference/journeys.ts';
import { OVERRIDES } from '../src/shared/reference/overrides.ts';
import type { Weekday } from '../src/shared/rules/types.ts';
import type { DirectionFile, LineFile, ReferenceFile } from '../src/shared/reference/types.ts';
import { redact, tflUrl } from '../src/shared/tfl-url.ts';
import { readTflKey } from './tfl-env.ts';

const RAIL_MODES = 'tube,elizabeth-line,dlr,overground,tram,cable-car';
const OUT = 'src/shared/reference/rail.json';
const STATIONS_OUT = 'src/shared/reference/stations.json';
const BUSES_OUT = 'src/shared/reference/buses.json';
const sequences: unknown[] = [];
const key = readTflKey();
const limit = createLimiter(6);
let calls = 0;

/** One TfL call; a 429, 5xx or network error is retried twice (thousands of journey planner pages). */
async function get(path: string, params: Record<string, string> = {}): Promise<unknown | null> {
  for (const wait of [0, 2_000, 10_000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const res = await limit(async () => {
      calls++;
      try {
        const r = await fetch(tflUrl(path, key, params), { signal: AbortSignal.timeout(30_000) });
        return r.ok ? { body: (await r.json()) as unknown } : r.status === 429 || r.status >= 500 ? 'retry' : null;
      } catch (err) {
        console.warn(`  ! ${path}: ${redact(String(err))}`);
        return 'retry';
      }
    });
    if (res === null) return null;
    if (res !== 'retry') return res.body;
  }
  return null;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}${String(min % 60).padStart(2, '0')}`;

/** One sampled day of departures from `stopId` towards `to`, paging through the journey planner. Null if a page failed. */
async function departuresTowards(lineId: string, mode: string, stopId: string, to: string, day: string): Promise<number[] | null> {
  const out = new Set<number>();
  let at = { date: day, time: hhmm(JOURNEYS.dayStartMin) };
  for (let page = 0; page < JOURNEYS.maxPagesPerDay; page++) {
    const body = await get(`/Journey/JourneyResults/${stopId}/to/${to}`, { mode, date: at.date, time: at.time, timeIs: 'Departing' });
    if (body === null) return null;
    const p = journeyPage(body, lineId, stopId, day);
    for (const d of p.departures) out.add(d);
    if (!p.next) break;
    const next = pageMinutes(day, p.next);
    if (next >= JOURNEYS.dayStartMin + 1440 || next <= pageMinutes(day, at)) break;
    at = p.next;
  }
  return [...out].filter((m) => m >= JOURNEYS.dayStartMin && m < JOURNEYS.dayStartMin + 1440);
}

const londonToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());

/**
 * A direction's timetable from the journey planner (ADR-018): every sampled day, towards every target.
 * A day with too few trains is retried a week later; if that fails too, no reference (fallback gap).
 */
async function directionFromJourneys(
  lineId: string,
  mode: string,
  stopId: string,
  dir: 'inbound' | 'outbound',
  used: Set<string>,
): Promise<DirectionFile | null> {
  const sequence = sequences.find((q) => (q as Json).lineId === lineId && (q as Json).direction === dir) ?? null;
  const targets = journeyTargets(sequence, stopId);
  if (targets.length === 0) return null; // the end of the line this way: nothing departs
  const groups = await Promise.all(
    sampleDays(londonToday).map(async ({ weekdays, dates }) => {
      for (const day of dates) {
        const each = await Promise.all(targets.map((to) => departuresTowards(lineId, mode, stopId, to, day)));
        if (each.some((d) => d === null)) continue;
        const departures = [...new Set(each.flat() as number[])];
        if (departures.length >= JOURNEYS.minDeparturesPerDay) {
          used.add(day);
          return { weekdays, departures };
        }
      }
      return { weekdays, departures: [] as number[] };
    }),
  );
  return directionFromDepartures(groups as { weekdays: Weekday[]; departures: number[] }[], dir);
}

type Json = Record<string, unknown>;
const lines = ((await get(`/Line/Mode/${RAIL_MODES}`)) ?? []) as Json[];
if (lines.length === 0) throw new Error('no lines from TfL');

const built: LineFile[] = await Promise.all(
  lines.map(async (l): Promise<LineFile> => {
    const lineId = String(l.id);
    const base = { lineId, lineName: String(l.name), mode: String(l.modeName) as Mode, notes: [] as string[] };

    // Both directions feed the station search index (a few stations are served one way only).
    for (const dir of ['outbound', 'inbound']) {
      const seq = await get(`/Line/${lineId}/Route/Sequence/${dir}`);
      if (seq) sequences.push(seq);
    }

    const override = OVERRIDES[lineId];
    if (override?.statusOnly) {
      base.notes.push(`override: ${override.reason}`);
      return { ...base, statusOnly: true, stations: [], boundDirections: {} };
    }
    const sequence = sequences.find((q) => (q as Json).lineId === lineId && (q as Json).direction === 'outbound') ?? null;
    let picks = pickCheckStations(sequence);
    if (override?.checkStations) {
      const names = new Map(picks.map((p) => [p.stopId, p.name]));
      picks = override.checkStations.map((id) => ({ stopId: id, name: names.get(id) ?? id }));
      base.notes.push(`override: ${override.reason}`);
    }

    const samples = await Promise.all(picks.map((p) => get(`/Line/${lineId}/Arrivals/${p.stopId}`)));
    const hasPredictions = samples.some((s) => Array.isArray(s) && s.length > 0);
    const everyCallFailed = samples.every((s) => s === null);
    if (picks.length < 2 || everyCallFailed) {
      base.notes.push(picks.length < 2 ? 'fewer than 2 check stations' : 'arrivals endpoint unavailable');
      return { ...base, statusOnly: true, stations: [], boundDirections: {} };
    }
    if (!hasPredictions) base.notes.push('no predictions in the sample (may be closed right now)');

    const stations = await Promise.all(
      picks.map(async (p) => {
        const directions = (
          await Promise.all(
            (['inbound', 'outbound'] as const).map(async (dir) => {
              // One retry: TfL has briefly left a schedule out (Piccadilly, 8 Nov 2026: no Mon–Thu).
              const fetchDir = async () =>
                directionFromTimetable(await get(`/Line/${lineId}/Timetable/${p.stopId}`, { direction: dir }), dir);
              const d = (await fetchDir()) ?? (await fetchDir());
              if (!d) base.notes.push(`no ${dir} timetable at ${p.name}`);
              return d;
            }),
          )
        ).filter((d): d is DirectionFile => d !== null);
        return { stopId: p.stopId, name: p.name, directions };
      }),
    );

    // TfL publishes no timetable for this line at all (Elizabeth line, Overground): use the journey planner.
    if (stations.every((s) => s.directions.length === 0)) {
      const used = new Set<string>();
      for (const s of stations) {
        s.directions = (
          await Promise.all(
            (['inbound', 'outbound'] as const).map((dir) => directionFromJourneys(lineId, String(l.modeName), s.stopId, dir, used)),
          )
        ).filter((d): d is DirectionFile => d !== null);
      }
      base.notes.push(`timetables from the journey planner (${[...used].sort().join(', ') || 'no usable day'})`);
    }

    const boundDirections = Object.assign({}, ...samples.map((s) => learnBoundDirections(s)));
    return { ...base, statusOnly: false, stations, boundDirections };
  }),
);

built.sort((a, b) => a.lineId.localeCompare(b.lineId));
const file: ReferenceFile = { generatedAt: new Date().toISOString(), lines: built };
const json = JSON.stringify(file);
if (/app_key=/.test(json)) throw new Error('key leaked into reference');
writeFileSync(OUT, `${json}\n`);

const stations = collectStations(sequences);
const stationsJson = JSON.stringify({ generatedAt: file.generatedAt, stations });
if (/app_key=/.test(stationsJson)) throw new Error('key leaked into stations');
writeFileSync(STATIONS_OUT, `${stationsJson}\n`);

// Bus routes for search (ids and names only; status is fetched per route on demand: the all-routes
// status call is ~800 KB and took 18 s when measured).
const busLines = ((await get('/Line/Mode/bus')) ?? []) as Json[];
const routes = busLines
  .map((l) => ({ id: String(l.id), name: String(l.name) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
if (routes.length === 0) throw new Error('no bus routes from TfL');
writeFileSync(BUSES_OUT, `${JSON.stringify({ generatedAt: file.generatedAt, routes })}\n`);
console.log(`Wrote ${BUSES_OUT} (${routes.length} routes)`);

console.log(`Wrote ${OUT} (${(json.length / 1024).toFixed(1)} KB) and ${STATIONS_OUT} (${stations.length} stations, ${(stationsJson.length / 1024).toFixed(1)} KB) from ${calls} calls`);
for (const l of built) {
  const st = l.statusOnly ? 'status-only' : l.stations.map((s) => `${s.name} [${s.directions.map((d) => d.directionKey[0]).join('')}]`).join(', ');
  console.log(`  ${l.lineId.padEnd(18)} ${st}${l.notes.length ? `  · ${l.notes.join('; ')}` : ''}`);
}
