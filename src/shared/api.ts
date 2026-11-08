/** Response contracts shared by the Worker and the client. */

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
