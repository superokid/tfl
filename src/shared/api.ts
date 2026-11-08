/** Response contracts shared by the Worker and the client. */
import type { StationBoard } from './boards';
import type { Mode } from './config';
import type { Expected, LineVerdict, VerdictKind, VerdictReason } from './rules/types';

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
}

/** Bump when a stored shape changes: a stored snapshot of another version is ignored and refreshed. */
export const SNAPSHOT_VERSION = 3;
export const LINES_VERSION = 1;

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
}

export interface LinesSnapshot {
  version: number;
  checkedAt: number;
  referenceGeneratedAt: string;
  lines: LineStatus[];
}

/** The latest "Check all lines" result, if recent: verdicts only. */
export interface CheckSummary {
  checkedAt: number;
  lines: Record<string, { verdict: VerdictKind; reason: VerdictReason | null; summary: string }>;
}

/** GET /api/lines (home screen). */
export interface LinesBody extends LinesSnapshot {
  serverNow: number;
  stale: boolean;
  checks: CheckSummary | null;
}

/** GET /api/line/:id (line screen). */
export interface LineBody extends LineReport {
  serverNow: number;
  stale: boolean;
}

export function isLinesBody(value: unknown): value is LinesBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.checkedAt === 'number' &&
    typeof v.serverNow === 'number' &&
    typeof v.stale === 'boolean' &&
    Array.isArray(v.lines) &&
    v.lines.every((l: unknown) => {
      const x = l as Record<string, unknown> | null;
      return !!x && typeof x.lineId === 'string' && typeof x.lineName === 'string' && typeof x.tflSays === 'string' && Array.isArray(x.messages);
    })
  );
}

export function isLineBody(value: unknown): value is LineBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.lineId === 'string' &&
    typeof v.serverNow === 'number' &&
    VERDICTS.includes(v.verdict as VerdictKind) &&
    Array.isArray(v.boards) &&
    Array.isArray(v.evidence)
  );
}

/** What is stored in D1 and served by /api/status. */
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
  stations: { id: string; name: string; lines: string[] }[];
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

export function isBusRouteBody(value: unknown): value is BusRouteBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.routeId === 'string' &&
    Array.isArray(v.statuses) &&
    Array.isArray(v.messages) &&
    Array.isArray(v.directions) &&
    typeof v.timesLive === 'boolean' &&
    typeof v.checkedAt === 'number'
  );
}

/** GET /api/station/:id: live departures at one station or bus stop, per line or route. */
export interface StationBody {
  stationId: string;
  name: string;
  checkedAt: number;
  serverNow: number;
  stale: boolean;
  lines: { lineId: string; lineName: string; board: StationBoard }[];
}

export function isStationBody(value: unknown): value is StationBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.stationId === 'string' &&
    typeof v.name === 'string' &&
    typeof v.checkedAt === 'number' &&
    typeof v.serverNow === 'number' &&
    typeof v.stale === 'boolean' &&
    Array.isArray(v.lines)
  );
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

const VERDICTS: VerdictKind[] = ['HIDDEN_DISRUPTION', 'STALE_ALERT', 'MATCH', 'CANT_VERIFY', 'CLOSED'];

export function isStatusBody(value: unknown): value is StatusBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.checkedAt === 'number' &&
    typeof v.serverNow === 'number' &&
    typeof v.stale === 'boolean' &&
    typeof v.referenceGeneratedAt === 'string' &&
    Array.isArray(v.lines) &&
    v.lines.every((l: unknown) => {
      if (typeof l !== 'object' || l === null) return false;
      const x = l as Record<string, unknown>;
      return (
        typeof x.lineId === 'string' &&
        typeof x.lineName === 'string' &&
        typeof x.summary === 'string' &&
        typeof x.tflSays === 'string' &&
        VERDICTS.includes(x.verdict as VerdictKind) &&
        Array.isArray(x.evidence) &&
        Array.isArray(x.messages) &&
        Array.isArray(x.boards)
      );
    })
  );
}
