/** The client trusts nothing it renders: a body (or device copy) of the wrong shape is rejected, not drawn. */
import { describe, expect, it } from 'vitest';
import {
  isBusRouteBody,
  isBusSearchBody,
  isIndexBody,
  isLineBody,
  isLinesBody,
  isNearbyBody,
  isStationBody,
  type BusRouteBody,
  type LineBody,
  type LinesBody,
  type NearbyBody,
  type StationBody,
} from '../../src/shared/api';
import { BUSES, STATIONS } from '../../src/shared/reference/load';

const board = { stopId: '940GZZLUOXC', name: 'Oxford Circus', live: true, directions: [{ key: 'p1', label: 'Platform 1', arrivals: [{ at: 1, destination: null, terminates: false }] }] };
const lines: LinesBody = {
  version: 1,
  checkedAt: 1,
  serverNow: 1,
  stale: false,
  referenceGeneratedAt: '2026-11-08',
  checks: null,
  lines: [{ lineId: 'victoria', lineName: 'Victoria', mode: 'tube', tflSays: 'Good Service', severity: 'NORMAL', messages: [], checkable: true, opensAt: null, offHours: false }],
};
const line: LineBody = {
  lineId: 'victoria',
  lineName: 'Victoria',
  mode: 'tube',
  verdict: 'MATCH',
  reason: null,
  tflSays: 'Good Service',
  summary: '',
  evidence: [],
  checkedAt: 1,
  messages: [],
  boards: [board],
  offHours: false,
  opensAt: null,
  serverNow: 1,
  stale: false,
};
const station: StationBody = { stationId: 'X', name: 'X', checkedAt: 1, serverNow: 1, stale: false, lines: [{ lineId: 'victoria', lineName: 'Victoria', board }] };
const bus: BusRouteBody = {
  routeId: '38',
  name: '38',
  statuses: [],
  messages: [],
  directions: [{ id: 'outbound', towards: 'Victoria', stops: [{ id: 'S', name: 'Stop', letter: null, arrivals: [1] }] }],
  timesLive: true,
  checkedAt: 1,
  serverNow: 1,
  stale: false,
};
const nearby: NearbyBody = {
  stops: [{ id: 'S', name: 'Stop', letter: null, towards: null, distanceM: 10, live: true, buses: [{ routeId: '38', routeName: '38', destination: null, times: [1] }] }],
  checkedAt: 1,
  serverNow: 1,
  stale: false,
};

/** `body` with the value at `path` replaced. */
function broken<T>(body: T, path: (string | number)[], value: unknown): unknown {
  const copy = structuredClone(body) as Record<string | number, unknown>;
  let at = copy;
  for (const k of path.slice(0, -1)) at = at[k] as Record<string | number, unknown>;
  at[path[path.length - 1]!] = value;
  return copy;
}

describe('response validators', () => {
  it('accept good bodies', () => {
    expect(isLinesBody(lines)).toBe(true);
    expect(isLineBody(line)).toBe(true);
    expect(isStationBody(station)).toBe(true);
    expect(isBusRouteBody(bus)).toBe(true);
    expect(isNearbyBody(nearby)).toBe(true);
    const index = { stations: STATIONS.stations.map(({ id, name, lines, lat, lon }) => ({ id, name, lines, lat, lon })), routes: BUSES.routes };
    expect(isIndexBody(index)).toBe(true);
    expect(isBusSearchBody({ query: 'oxf', stops: [{ id: '490000173RC', name: 'Oxford Circus', towards: null }] })).toBe(true);
  });

  it.each([
    ['lines: message not a string', isLinesBody, lines, ['lines', 0, 'messages'], [1]],
    ['lines: checks not an object', isLinesBody, lines, ['checks'], 'x'],
    ['line: board without directions', isLineBody, line, ['boards', 0, 'directions'], null],
    ['line: arrival without a time', isLineBody, line, ['boards', 0, 'directions', 0, 'arrivals', 0, 'at'], 'soon'],
    ['line: messages missing', isLineBody, line, ['messages'], undefined],
    ['line: evidence row without a direction', isLineBody, line, ['evidence'], [{ stationName: 'X' }]],
    ['station: line without a board', isStationBody, station, ['lines', 0, 'board'], null],
    ['bus: stop without arrivals', isBusRouteBody, bus, ['directions', 0, 'stops', 0, 'arrivals'], null],
    ['bus: serverNow missing', isBusRouteBody, bus, ['serverNow'], undefined],
    ['nearby: bus row without times', isNearbyBody, nearby, ['stops', 0, 'buses', 0, 'times'], null],
  ] as const)('reject %s', (_, valid, body, path, value) => {
    expect((valid as (v: unknown) => boolean)(broken(body, [...path], value))).toBe(false);
  });

  it('reject an index or search body of the wrong shape', () => {
    expect(isIndexBody({ stations: [{ id: 'X' }], routes: [] })).toBe(false);
    expect(isIndexBody(null)).toBe(false);
    expect(isBusSearchBody({ query: 'x', stops: [{ id: 1 }] })).toBe(false);
  });
});
