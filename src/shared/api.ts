/** Response contracts shared by the Worker and the client. */
import type { StationBoard } from './boards';
import type { Mode } from './config';
import type { Expected, LineVerdict, StatusInput, VerdictKind, VerdictReason } from './rules/types';

export interface HealthBody {
  status: 'ok';
  serverNow: string;
  version: string;
  /** Whether the TfL key is configured. Never the key itself. */
  tflKeyConfigured: boolean;
}

export interface ErrorBody {
  error: string;
}

/** A line as served: the verdict, TfL's own messages, and live arrivals at the check stations. */
export interface LineReport extends LineVerdict {
  /** TfL's passenger messages for the current statuses (de-duplicated). */
  messages: string[];
  boards: StationBoard[];
  /** Closed outside its hours, and when trains are next expected (epoch ms, null if unknown). As LineStatus. */
  offHours: boolean;
  opensAt: number | null;
}

/** Bump when a stored shape changes: a stored snapshot of another version is ignored and refreshed. */
export const SNAPSHOT_VERSION = 5;
export const LINES_VERSION = 3;

/** One line on the home screen: TfL's status only (ADR-011). */
export interface LineStatus {
  lineId: string;
  lineName: string;
  mode: Mode;
  /** TfL's status as published, e.g. "Good Service" or "Severe Delays, Part Suspended". */
  tflSays: string;
  /** How bad TfL says it is (for colour and order); null if a status isn't recognised. */
  severity: Expected | null;
  messages: string[];
  /** False for lines with no live predictions (Cable Car): never checked. */
  checkable: boolean;
  /** TfL says closed and the timetable has no service now (night, or a day it doesn't run): when
   * trains are next expected (epoch ms), from TfL's message or the first timetabled train. Else null. */
  opensAt: number | null;
  /** Closed outside hours, but no time known (no timetable, TfL said "later this morning"). */
  offHours: boolean;
}

export interface LinesSnapshot {
  version: number;
  checkedAt: number;
  referenceGeneratedAt: string;
  lines: LineStatus[];
  /** TfL's statuses by line id, kept so the line screen needn't fetch its own. Not sent to the browser. */
  statuses: Record<string, StatusInput[]>;
}

/** The latest "Check all lines" result, if recent: verdicts only. */
export interface CheckSummary {
  checkedAt: number;
  lines: Record<string, { verdict: VerdictKind; reason: VerdictReason | null; summary: string }>;
}

/** GET /api/lines (home screen). */
export interface LinesBody extends Omit<LinesSnapshot, 'statuses'> {
  serverNow: number;
  stale: boolean;
  checks: CheckSummary | null;
}

/** GET /api/line/:id (line screen). */
export interface LineBody extends LineReport {
  serverNow: number;
  stale: boolean;
}

/** What is stored in D1 and served by /api/checks. */
export interface Snapshot {
  version: number;
  /** When TfL was last read successfully (epoch ms). */
  checkedAt: number;
  /** When the rail reference data was generated (ISO). */
  referenceGeneratedAt: string;
  lines: LineReport[];
}

export interface StatusBody extends Snapshot {
  serverNow: number;
  /** True when the data is older than it should be: TfL failing, or the budget is spent. */
  stale: boolean;
}

/** GET /api/index: everything the search box needs, so typing never calls TfL for stations or routes. */
export interface IndexBody {
  /** `lat`/`lon` let the phone find lines near you without sending its position anywhere. */
  stations: { id: string; name: string; lines: string[]; lat?: number; lon?: number }[];
  routes: { id: string; name: string }[];
}

/** GET /api/search?q=: bus stops matching a name (TfL search, cached a day per query). */
export interface BusStopMatch {
  id: string;
  name: string;
  /** TfL's "towards" text: how passengers tell stops with the same name apart. */
  towards: string | null;
}

export interface BusSearchBody {
  query: string;
  stops: BusStopMatch[];
}

export interface RouteStop {
  id: string;
  name: string;
  /** Stop letter on the flag ("E"), if TfL gives one. */
  letter: string | null;
  /** Next buses on this route at this stop (epoch ms), soonest first, at most 3. */
  arrivals: number[];
}

export interface RouteDirection {
  id: 'outbound' | 'inbound';
  /** Last stop: "Victoria". */
  towards: string;
  stops: RouteStop[];
}

/** GET /api/bus/:route: status, and every stop in order with its next buses. One request per refresh. */
export interface BusRouteBody {
  routeId: string;
  name: string;
  /** TfL status descriptions, e.g. ["Good Service"] or ["Special Service"]; [] if TfL didn't answer. */
  statuses: string[];
  messages: string[];
  directions: RouteDirection[];
  /** False when TfL's arrivals call failed: stops are listed without times. */
  timesLive: boolean;
  checkedAt: number;
  serverNow: number;
  stale: boolean;
}

/** One route's next buses at a stop, to one destination: "38 to Victoria · 2, 9, 14 min". */
export interface BusTimes {
  routeId: string;
  routeName: string;
  /** "Victoria", "Terminates here", or null if TfL gave none. */
  destination: string | null;
  /** Epoch ms, soonest first, at most 3. */
  times: number[];
}

export interface NearbyStop {
  id: string;
  name: string;
  /** Letter on the stop flag ("RC"), if TfL gives one. */
  letter: string | null;
  towards: string | null;
  /** Metres from the passenger's ~100 m cell. */
  distanceM: number;
  /** False when TfL's arrivals call failed or was skipped: the UI says so. */
  live: boolean;
  /** Soonest first. */
  buses: BusTimes[];
}

/** GET /api/nearby?lat&lon: the closest bus stops with their next buses. One request per refresh. */
export interface NearbyBody {
  stops: NearbyStop[];
  /** Oldest stop's data time, so the "Updated" age is never flattering. */
  checkedAt: number;
  serverNow: number;
  stale: boolean;
}

/** GET /api/station/:id: live departures at one station or bus stop, per line or route. */
export interface StationBody {
  stationId: string;
  name: string;
  /** Bus stops only: the letter on the stop flag ("RC") and TfL's direction text, when known. */
  letter?: string | null;
  towards?: string | null;
  checkedAt: number;
  serverNow: number;
  stale: boolean;
  lines: { lineId: string; lineName: string; board: StationBoard }[];
}

export function isHealthBody(value: unknown): value is HealthBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.status === 'ok' &&
    typeof v.serverNow === 'string' &&
    !Number.isNaN(Date.parse(v.serverNow)) &&
    typeof v.version === 'string' &&
    typeof v.tflKeyConfigured === 'boolean'
  );
}

// ── Validators: the client renders nothing it hasn't checked (live bodies and device copies alike) ──

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strOrNull = (v: unknown) => v === null || str(v);
const list = (v: unknown, item: (x: unknown) => boolean) => Array.isArray(v) && v.every(item);
const strs = (v: unknown) => list(v, str);
/** An object whose `keys` all pass `check`. */
const has = (v: unknown, check: (x: unknown) => boolean, ...keys: string[]): v is Obj => obj(v) && keys.every((k) => check(v[k]));
const live = (v: Obj) => num(v.checkedAt) && num(v.serverNow) && typeof v.stale === 'boolean';

const VERDICTS: VerdictKind[] = ['HIDDEN_DISRUPTION', 'STALE_ALERT', 'MATCH', 'CANT_VERIFY', 'CLOSED'];

const numOrNull = (v: unknown) => v === null || num(v);
/** Optional in stored device copies from before the field existed. */
const optNumOrNull = (v: unknown) => v === undefined || numOrNull(v);
const optBool = (v: unknown) => v === undefined || typeof v === 'boolean';

const isBoard = (b: unknown) =>
  has(b, str, 'stopId', 'name') &&
  typeof b.live === 'boolean' &&
  optNumOrNull(b.firstTrainAt) &&
  list(b.directions, (d) => has(d, str, 'key', 'label') && list(d.arrivals, (a) => has(a, num, 'at') && strOrNull(a.destination)));

const isReport = (l: unknown) =>
  has(l, str, 'lineId', 'lineName', 'tflSays', 'summary') &&
  VERDICTS.includes(l.verdict as VerdictKind) &&
  strOrNull(l.reason) &&
  num(l.checkedAt) &&
  strs(l.messages) &&
  optNumOrNull(l.opensAt) &&
  optBool(l.offHours) &&
  list(l.boards, isBoard) &&
  list(l.evidence, (e) => has(e, str, 'stationName', 'directionKey', 'directionLabel'));

export function isLinesBody(v: unknown): v is LinesBody {
  return (
    obj(v) &&
    live(v) &&
    (v.checks === null || v.checks === undefined || (obj(v.checks) && obj(v.checks.lines))) &&
    list(v.lines, (l) => has(l, str, 'lineId', 'lineName', 'tflSays', 'mode') && strOrNull(l.severity) && strs(l.messages) && optNumOrNull(l.opensAt) && optBool(l.offHours))
  );
}

export function isLineBody(v: unknown): v is LineBody {
  return obj(v) && live(v) && isReport(v);
}

export function isStatusBody(v: unknown): v is StatusBody {
  return obj(v) && live(v) && str(v.referenceGeneratedAt) && list(v.lines, isReport);
}

export function isStationBody(v: unknown): v is StationBody {
  return has(v, str, 'stationId', 'name') && live(v) && list(v.lines, (l) => has(l, str, 'lineId', 'lineName') && isBoard(l.board));
}

export function isBusRouteBody(v: unknown): v is BusRouteBody {
  return (
    has(v, str, 'routeId', 'name') &&
    live(v) &&
    typeof v.timesLive === 'boolean' &&
    strs(v.statuses) &&
    strs(v.messages) &&
    list(
      v.directions,
      (d) => has(d, str, 'id', 'towards') && list(d.stops, (s) => has(s, str, 'id', 'name') && strOrNull(s.letter) && list(s.arrivals, num)),
    )
  );
}

export function isNearbyBody(v: unknown): v is NearbyBody {
  return (
    obj(v) &&
    live(v) &&
    list(
      v.stops,
      (s) =>
        has(s, str, 'id', 'name') &&
        num(s.distanceM) &&
        strOrNull(s.letter) &&
        strOrNull(s.towards) &&
        list(s.buses, (b) => has(b, str, 'routeId', 'routeName') && strOrNull(b.destination) && list(b.times, num)),
    )
  );
}

export function isIndexBody(v: unknown): v is IndexBody {
  return obj(v) && list(v.stations, (s) => has(s, str, 'id', 'name') && strs(s.lines)) && list(v.routes, (r) => has(r, str, 'id', 'name'));
}

export function isBusSearchBody(v: unknown): v is BusSearchBody {
  return obj(v) && list(v.stops, (s) => has(s, str, 'id', 'name') && strOrNull(s.towards));
}
