/**
 * Captures trimmed live TfL responses into test/fixtures (SPEC §7). Re-run any time:
 *   bun scripts/capture-fixtures.ts
 * The key is read from .dev.vars, only ever placed in the request URL, and every body is redacted
 * before it is written. Fixtures are trimmed to what tests need, to keep the repo small.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { redact, tflUrl } from '../src/shared/tfl-url.ts';
import { readTflKey } from './tfl-env.ts';

const RAIL_MODES = 'tube,elizabeth-line,dlr,overground,tram,cable-car';
const OUT = 'test/fixtures';
const key = readTflKey();

type Json = Record<string, unknown>;
const pick = (o: Json, keys: string[]): Json => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

const ARRIVAL_KEYS = [
  'id', 'vehicleId', 'naptanId', 'stationName', 'lineId', 'lineName', 'platformName', 'direction',
  'destinationNaptanId', 'destinationName', 'timeToStation', 'expectedArrival', 'towards', 'timing', 'modeName',
];
const trimArrivals = (body: unknown) =>
  (body as Json[]).map((a) => {
    const t = pick(a, ARRIVAL_KEYS);
    if (t.timing && typeof t.timing === 'object') t.timing = pick(t.timing as Json, ['read', 'sent']);
    return t;
  });

const trimStatus = (body: unknown) =>
  (body as Json[]).map((l) => ({
    ...pick(l, ['id', 'name', 'modeName']),
    lineStatuses: (l.lineStatuses as Json[]).map((s) => {
      const t = pick(s, ['statusSeverity', 'statusSeverityDescription', 'reason', 'validityPeriods', 'disruption']);
      const d = t.disruption as Json | undefined;
      if (d) {
        t.disruption = {
          ...pick(d, ['category', 'description']),
          affectedStops: ((d.affectedStops as Json[] | undefined) ?? []).map((st) => pick(st, ['naptanId', 'commonName'])),
        };
      }
      return t;
    }),
  }));

const trimSequence = (body: unknown) => {
  const b = body as Json;
  return {
    ...pick(b, ['lineId', 'lineName', 'direction', 'mode']),
    orderedLineRoutes: b.orderedLineRoutes,
    stopPointSequences: (b.stopPointSequences as Json[]).map((s) => ({
      ...pick(s, ['branchId', 'direction']),
      stopPoint: (s.stopPoint as Json[]).map((p) => ({
        ...pick(p, ['id', 'name', 'topMostParentId']),
        lines: ((p.lines as Json[] | undefined) ?? []).map((l) => l.id),
      })),
    })),
  };
};

const trimTimetable = (body: unknown) => {
  const b = body as Json;
  const tt = b.timetable as Json | undefined;
  return {
    ...pick(b, ['lineId', 'direction']),
    timetable: tt && {
      departureStopId: tt.departureStopId,
      routes: (tt.routes as Json[]).map((r) => ({
        schedules: (r.schedules as Json[]).map((s) => ({
          name: s.name,
          firstJourney: pick(s.firstJourney as Json, ['hour', 'minute']),
          lastJourney: pick(s.lastJourney as Json, ['hour', 'minute']),
          knownJourneys: (s.knownJourneys as Json[]).map((j) => pick(j, ['hour', 'minute'])),
        })),
      })),
    },
  };
};

const trimStops = (body: unknown) => ({
  stopPoints: ((body as Json).stopPoints as Json[]).map((p) => ({
    ...pick(p, ['id', 'commonName', 'stopLetter', 'indicator', 'distance', 'lat', 'lon']),
    lines: ((p.lines as Json[] | undefined) ?? []).map((l) => pick(l, ['id', 'name'])),
    additionalProperties: ((p.additionalProperties as Json[] | undefined) ?? []).filter((a) => a.key === 'Towards').map((a) => pick(a, ['key', 'value'])),
  })),
});

const identity = (b: unknown) => b;

const CAPTURES: { name: string; path: string; params?: Record<string, string>; trim: (b: unknown) => unknown }[] = [
  { name: 'lines-rail', path: `/Line/Mode/${RAIL_MODES}`, trim: (b) => (b as Json[]).map((l) => pick(l, ['id', 'name', 'modeName'])) },
  { name: 'status-rail', path: `/Line/Mode/${RAIL_MODES}/Status`, trim: trimStatus },
  { name: 'status-rail-detail', path: `/Line/Mode/${RAIL_MODES}/Status`, params: { detail: 'true' }, trim: trimStatus },
  { name: 'severity', path: '/Line/Meta/Severity', trim: identity },
  { name: 'seq-northern-outbound', path: '/Line/northern/Route/Sequence/outbound', trim: trimSequence },
  { name: 'seq-liberty-outbound', path: '/Line/liberty/Route/Sequence/outbound', trim: trimSequence },
  { name: 'arr-victoria-oxford-circus', path: '/Line/victoria/Arrivals/940GZZLUOXC', trim: trimArrivals },
  { name: 'arr-multi-oxford-circus', path: '/Line/bakerloo,central,victoria/Arrivals/940GZZLUOXC', trim: trimArrivals },
  { name: 'arr-bakerloo-harlesden', path: '/Line/bakerloo/Arrivals/940GZZLUHSN', trim: trimArrivals },
  { name: 'arr-bakerloo-queens-park', path: '/Line/bakerloo/Arrivals/940GZZLUQPS', trim: trimArrivals },
  { name: 'tt-victoria-brixton', path: '/Line/victoria/Timetable/940GZZLUBXN', trim: trimTimetable },
  {
    name: 'nearby-oxford-circus',
    path: '/StopPoint',
    params: { lat: '51.515', lon: '-0.142', stopTypes: 'NaptanPublicBusCoachTram', radius: '400', modes: 'bus', returnLines: 'true' },
    trim: trimStops,
  },
  { name: 'tt-northern-euston-outbound', path: '/Line/northern/Timetable/940GZZLUEUS', params: { direction: 'outbound' }, trim: trimTimetable },
];

mkdirSync(OUT, { recursive: true });
const capturedAt = new Date().toISOString();
await Promise.all(
  CAPTURES.map(async (c) => {
    const res = await fetch(tflUrl(c.path, key, c.params), { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      console.log(`SKIP ${c.name}: HTTP ${res.status}`);
      return;
    }
    const text = redact(JSON.stringify({ capturedAt, path: c.path, params: c.params ?? {}, body: c.trim(await res.json()) }));
    if (/app_key=(?!REDACTED)/.test(text)) throw new Error(`key leaked into ${c.name}`);
    writeFileSync(`${OUT}/${c.name}.json`, `${text}\n`);
    console.log(`OK   ${c.name} (${(text.length / 1024).toFixed(1)} KB)`);
  }),
);
