/** Response contracts shared by the Worker and the client. */
import type { StationBoard } from './boards';
import type { LineVerdict, VerdictKind } from './rules/types';

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

/** Bump when the Snapshot shape changes: a stored snapshot of another version is ignored and refreshed. */
export const SNAPSHOT_VERSION = 3;

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

/** GET /api/bus/:route: one bus route's status, on demand. */
export interface BusRouteBody {
  routeId: string;
  name: string;
  /** TfL status descriptions, e.g. ["Good Service"] or ["Special Service"]. */
  statuses: string[];
  messages: string[];
  checkedAt: number;
  serverNow: number;
  stale: boolean;
}

export function isBusRouteBody(value: unknown): value is BusRouteBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.routeId === 'string' && Array.isArray(v.statuses) && Array.isArray(v.messages) && typeof v.checkedAt === 'number';
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
