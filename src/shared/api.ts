/** Response contracts shared by the Worker and the client. */
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

/** What is stored in D1 and served by /api/status. */
export interface Snapshot {
  /** When TfL was last read successfully (epoch ms). */
  checkedAt: number;
  /** When the rail reference data was generated (ISO). */
  referenceGeneratedAt: string;
  lines: LineVerdict[];
}

export interface StatusBody extends Snapshot {
  serverNow: number;
  /** True when the data is older than it should be: TfL failing, or the budget is spent. */
  stale: boolean;
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
        Array.isArray(x.evidence)
      );
    })
  );
}
