/**
 * GET /api/line/:id (ADR-011): one line's live check and next trains, fetched when a passenger opens the
 * line. 1 + (check stops) TfL calls, cached 30 s at the edge, concurrent requests share one fetch, last
 * good copy served stale if TfL fails. No D1 writes.
 */
import type { ErrorBody, LineBody, LineReport } from '../shared/api';
import { LIVE } from '../shared/config';
import type { ReferenceFile } from '../shared/reference/types';
import { redact } from '../shared/tfl-url';
import type { JsonCache } from './bus';
import { json } from './http';
import { buildLineReport } from './refresh';
import type { CallLimiter } from './station';
import type { TflClient } from './tfl/client';

export interface LineDeps {
  lineId: string;
  reference: ReferenceFile;
  cache: JsonCache;
  limiter: CallLimiter;
  tfl: () => TflClient;
  now: number;
}

const inFlight = new Map<string, Promise<LineReport | null>>();

export async function handleLine(deps: LineDeps): Promise<Response> {
  const ref = deps.reference.lines.find((l) => l.lineId === deps.lineId);
  if (!ref) return json({ error: 'unknown_line' } satisfies ErrorBody, { status: 404, headers: { 'Cache-Control': 'no-store' } });

  const key = `line:${ref.lineId}`;
  const respond = (r: LineReport, stale: boolean) => {
    const maxAge = Math.max(1, Math.round((LIVE.stationFreshMs - (deps.now - r.checkedAt)) / 1000));
    return json({ ...r, serverNow: deps.now, stale } satisfies LineBody, {
      headers: { 'Cache-Control': stale ? 'no-store' : `public, max-age=${maxAge}` },
    });
  };

  const cached = await deps.cache.get<LineReport>(key).catch(() => null);
  if (cached && deps.now - cached.checkedAt < LIVE.stationFreshMs) return respond(cached, false);

  let pending = inFlight.get(key);
  if (!pending) {
    const calls = 1 + (ref.statusOnly ? 0 : ref.stations.length);
    pending = deps.limiter.tryTake(deps.now, calls)
      ? buildLineReport(deps.tfl(), deps.reference, ref.lineId, deps.now)
          .then(async (r) => {
            if (r) await deps.cache.put(key, r, LIVE.stationKeepMs).catch(() => {});
            return r;
          })
          .catch((err: unknown) => {
            console.error('line check failed:', redact(err instanceof Error ? err.message : String(err)));
            return null;
          })
      : Promise.resolve(null);
    inFlight.set(key, pending);
    void pending.finally(() => inFlight.delete(key));
  }
  const fresh = await pending;
  if (fresh) return respond(fresh, false);
  return cached
    ? respond(cached, true)
    : json({ error: 'tfl_unavailable' } satisfies ErrorBody, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });
}
