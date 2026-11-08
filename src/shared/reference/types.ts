import type { Mode } from '../config';
import type { ServiceDay } from '../rules/types';

/** Compact on-disk form of one direction's timetable at one stop (ADR-007). */
export interface DirectionFile {
  directionKey: 'inbound' | 'outbound';
  /** Distinct service days (Mon–Thu usually share one). */
  serviceDays: ServiceDay[];
  /** Index into `serviceDays` per weekday, Sunday first; -1 = no service that day. */
  weekdays: [number, number, number, number, number, number, number];
}

export interface StationFile {
  stopId: string;
  name: string;
  directions: DirectionFile[];
}

export interface LineFile {
  lineId: string;
  lineName: string;
  mode: Mode;
  /** No live predictions exist for this line (e.g. Cable Car): show status, never judge it. */
  statusOnly: boolean;
  stations: StationFile[];
  /** Compass word on platform names → TfL direction, learnt from live arrivals ("northbound" → "outbound"). */
  boundDirections: Record<string, 'inbound' | 'outbound'>;
  /** Anything the generator had to fall back on, for the README. */
  notes: string[];
}

export interface ReferenceFile {
  generatedAt: string;
  lines: LineFile[];
}
