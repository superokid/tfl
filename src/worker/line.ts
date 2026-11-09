/**
 * GET /api/line/:id (ADR-011): one line's live check and next trains, fetched when a passenger opens the
 * line. One TfL call per check stop; the status comes from the home screen's shared snapshot when it is
 * under 90 s old (else 1 more call: ADR-015). Cached at the edge: < 30 s served as is; 30–90 s served at once
 * and refreshed in `waitUntil` (ADR-006); older checked inline. Concurrent requests share one fetch, last
 * good copy served stale if TfL fails. No D1 writes.
 */
import type { ErrorBody, LineBody, LineReport } from '../shared/api';
import { LIVE } from '../shared/config';
import type { ReferenceFile } from '../shared/reference/types';
import type { StatusInput } from '../shared/rules/types';
import { redact } from '../shared/tfl-url';
import type { JsonCache } from './bus';
import { json } from './http';
import { buildLineReport } from './refresh';
import type { CallLimiter } from './station';
import type { TflClient } from './tfl/client';

/** The home screen's stored statuses (ADR-015). */
export interface SharedStatuses {
  checkedAt: number;
  statuses: Record<string, StatusInput[]>;
}

export interface LineDeps {
  lineId: string;
  reference: ReferenceFile;
  cache: JsonCache;
  limiter: CallLimiter;
  /** May refresh the shared snapshot (1–2 TfL calls, lease-limited like /api/lines). Null or a throw: none. */
  sharedStatuses: () => Promise<SharedStatuses | null>;
  tfl: () => TflClient;
  now: number;
  waitUntil: (p: Promise<unknown>) => void;
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
  const age = cached ? deps.now - cached.checkedAt : Infinity;
  if (cached && age < LIVE.stationFreshMs) return respond(cached, false);

  const pending = refresh(deps, ref.lineId, ref.statusOnly ? 0 : ref.stations.length);
  if (cached && age < LIVE.staleWhileRevalidateMs) {
    // The age is in the body and shown on screen; a failed refresh just leaves this copy in place.
    deps.waitUntil(pending);
    return respond(cached, false);
  }
  const fresh = await pending;
  if (fresh) return respond(fresh, false);
  return cached
    ? respond(cached, true)
    : json({ error: 'tfl_unavailable' } satisfies ErrorBody, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });
}

/**
 * The line's statuses from the shared snapshot if under the revalidate window; else null (fetch them),
 * after taking that 1 call from the limit. A status older than that would risk a verdict on old news.
 */
async function knownStatuses(deps: LineDeps, lineId: string): Promise<StatusInput[] | null> {
  const shared = await deps.sharedStatuses().catch((err: unknown) => {
    console.error('shared statuses unavailable:', redact(err instanceof Error ? err.message : String(err)));
    return null;
  });
  if (shared && deps.now - shared.checkedAt < LIVE.staleWhileRevalidateMs) return shared.statuses[lineId] ?? [];
  if (!deps.limiter.tryTake(deps.now, 1)) throw new Error('over the on-demand call limit');
  return null;
}

/** One check per line per isolate at a time; null when over the call limit or TfL failed. */
function refresh(deps: LineDeps, lineId: string, arrivalsCalls: number): Promise<LineReport | null> {
  const key = `line:${lineId}`;
  let pending = inFlight.get(key);
  if (pending) return pending;
  pending = deps.limiter.tryTake(deps.now, arrivalsCalls)
    ? buildLineReport(deps.tfl(), deps.reference, lineId, deps.now, () => knownStatuses(deps, lineId))
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
  return pending;
}
