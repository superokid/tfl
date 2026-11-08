import { LIVE } from '../../shared/config';
import { createLimiter } from '../../shared/limit';
import { redact, tflUrl } from '../../shared/tfl-url';

export type TflFailure = 'http' | 'timeout' | 'network' | 'invalid';

/** A TfL call failed. The message is always redacted: it is safe to log or return. */
export class TflError extends Error {
  constructor(
    readonly kind: TflFailure,
    message: string,
  ) {
    super(redact(message));
    this.name = 'TflError';
  }
}

export interface TflClient {
  getJson(path: string, params?: Record<string, string>): Promise<unknown>;
  /** Calls made so far by this client (each counts as a subrequest). */
  readonly calls: number;
}

/**
 * At most 6 calls in flight; each call's timeout starts when it is sent, not when queued (ADR-006).
 * The URL (which contains the key) never leaves this function.
 */
export function createTflClient(appKey: string, fetchImpl: typeof fetch = fetch): TflClient {
  const limit = createLimiter(LIVE.concurrency);
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    getJson(path, params = {}) {
      return limit(async () => {
        calls++;
        let res: Response;
        try {
          res = await fetchImpl(tflUrl(path, appKey, params), {
            signal: AbortSignal.timeout(LIVE.timeoutMs),
            headers: { Accept: 'application/json' },
          });
        } catch (err) {
          const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
          throw new TflError(timeout ? 'timeout' : 'network', `${path}: ${String(err)}`);
        }
        if (!res.ok) throw new TflError('http', `${path}: HTTP ${res.status}`);
        try {
          return (await res.json()) as unknown;
        } catch {
          throw new TflError('invalid', `${path}: body is not JSON`);
        }
      });
    },
  };
}
