/**
 * GET /api/status (SPEC §4.1, ADR-006): stale-while-revalidate over a D1 snapshot. Most requests are one
 * D1 read. Only the lease winner calls TfL, and only within the global budget.
 */
import type { ErrorBody, Snapshot, StatusBody } from '../shared/api';
import { LIVE } from '../shared/config';
import type { ReferenceFile } from '../shared/reference/types';
import { redact } from '../shared/tfl-url';
import { json } from './http';
import { buildSnapshot } from './refresh';
import type { Store } from './store';
import type { TflClient } from './tfl/client';

export interface StatusDeps {
  store: Store;
  tfl: () => TflClient;
  reference: ReferenceFile;
  now: number;
  waitUntil: (p: Promise<unknown>) => void;
}

/** Upper bound on TfL calls for one refresh: status + detail + one per check stop. */
export function plannedCalls(reference: ReferenceFile): number {
  const stops = new Set(reference.lines.filter((l) => !l.statusOnly).flatMap((l) => l.stations.map((s) => s.stopId)));
  return Math.min(LIVE.maxCallsPerRefresh, 2 + stops.size);
}

function respond(snapshot: Snapshot, now: number, stale: boolean): Response {
  const age = now - snapshot.checkedAt;
  const body: StatusBody = { ...snapshot, serverNow: now, stale };
  const maxAge = Math.max(1, Math.round((LIVE.freshMs - age) / 1000));
  return json(body, { headers: { 'Cache-Control': `public, max-age=${maxAge}` } });
}

const unavailable = () =>
  json({ error: 'tfl_unavailable' } satisfies ErrorBody, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });

async function refresh(deps: StatusDeps, previous: Snapshot | null): Promise<Snapshot | null> {
  const { store, reference, now } = deps;
  if (!(await store.reserveBudget(now, plannedCalls(reference), LIVE.budgetPerMinute))) {
    await store.markFailed(now);
    return null;
  }
  try {
    const snapshot = await buildSnapshot(deps.tfl(), reference, now, previous);
    await store.write(snapshot);
    return snapshot;
  } catch (err) {
    console.error('refresh failed:', redact(err instanceof Error ? err.message : String(err)));
    await store.markFailed(now);
    return null;
  }
}

export async function handleStatus(deps: StatusDeps): Promise<Response> {
  const { store, now } = deps;
  const { snapshot, failedAt } = await store.read();
  const age = snapshot ? now - snapshot.checkedAt : Infinity;
  const lastFailure = snapshot && failedAt !== null && failedAt >= snapshot.checkedAt ? failedAt : null;
  const failing = lastFailure !== null;

  if (snapshot && age < LIVE.freshMs) return respond(snapshot, now, failing);
  // TfL just failed: don't retry on every request while it's down.
  if (snapshot && lastFailure !== null && now - lastFailure < LIVE.failureBackoffMs) return respond(snapshot, now, true);

  if (snapshot && age < LIVE.staleWhileRevalidateMs) {
    if (await store.tryLease(now, LIVE.leaseMs)) deps.waitUntil(refresh(deps, snapshot));
    return respond(snapshot, now, failing);
  }

  if (await store.tryLease(now, LIVE.leaseMs)) {
    const fresh = await refresh(deps, snapshot);
    if (fresh) return respond(fresh, now, false);
  }
  return snapshot ? respond(snapshot, now, true) : unavailable();
}

/** D1 is down: call TfL directly, memoised per isolate so a burst doesn't multiply calls. */
let memo: { at: number; snapshot: Snapshot } | null = null;
export async function handleStatusWithoutStore(tfl: () => TflClient, reference: ReferenceFile, now: number): Promise<Response> {
  if (memo && now - memo.at < LIVE.memoMs) return respond(memo.snapshot, now, false);
  try {
    const snapshot = await buildSnapshot(tfl(), reference, now, memo?.snapshot ?? null);
    memo = { at: now, snapshot };
    return respond(snapshot, now, false);
  } catch (err) {
    console.error('direct refresh failed:', redact(err instanceof Error ? err.message : String(err)));
    return memo ? respond(memo.snapshot, now, true) : unavailable();
  }
}

export function resetMemoForTests() {
  memo = null;
}
