/**
 * Snapshot endpoints (SPEC §4.1, ADR-006/009/011): stale-while-revalidate over a keyed D1 snapshot.
 * Most requests are one D1 read; only the lease winner calls TfL, at most once per 30 s per snapshot.
 * - GET /api/lines: statuses for the home screen (1–2 TfL calls per refresh).
 * - GET /api/checks: every line's live check, only when the user asks (~42 calls per refresh).
 */
import type { CheckSummary, ErrorBody, LinesBody, LinesSnapshot, Snapshot, StatusBody } from '../shared/api';
import { LIVE } from '../shared/config';
import type { ReferenceFile } from '../shared/reference/types';
import { redact } from '../shared/tfl-url';
import { json } from './http';
import { buildLinesSnapshot, buildSnapshot } from './refresh';
import type { Store, Versioned } from './store';
import type { TflClient } from './tfl/client';

/** A check-all result older than this isn't shown on the home screen. */
const CHECKS_SHOWN_FOR_MS = 10 * 60_000;

interface Serve<S extends Versioned> {
  store: Store<S>;
  now: number;
  waitUntil: (p: Promise<unknown>) => void;
  build: (previous: S | null) => Promise<S>;
  respond: (snapshot: S, stale: boolean) => Promise<Response> | Response;
}

const unavailable = () =>
  json({ error: 'tfl_unavailable' } satisfies ErrorBody, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });

const maxAge = (checkedAt: number, now: number) => Math.max(1, Math.round((LIVE.freshMs - (now - checkedAt)) / 1000));

async function refresh<S extends Versioned>(s: Serve<S>, previous: S | null): Promise<S | null> {
  try {
    const snapshot = await s.build(previous);
    await s.store.write(snapshot);
    return snapshot;
  } catch (err) {
    console.error('refresh failed:', redact(err instanceof Error ? err.message : String(err)));
    await s.store.markFailed(s.now);
    return null;
  }
}

async function serve<S extends Versioned>(s: Serve<S>): Promise<Response> {
  const { store, now } = s;
  const { snapshot, failedAt } = await store.read();
  const age = snapshot ? now - snapshot.checkedAt : Infinity;
  const lastFailure = snapshot && failedAt !== null && failedAt >= snapshot.checkedAt ? failedAt : null;
  const failing = lastFailure !== null;

  if (snapshot && age < LIVE.freshMs) return s.respond(snapshot, failing);
  // TfL just failed: don't retry on every request while it's down.
  if (snapshot && lastFailure !== null && now - lastFailure < LIVE.failureBackoffMs) return s.respond(snapshot, true);

  if (snapshot && age < LIVE.staleWhileRevalidateMs) {
    if (await store.tryLease(now, LIVE.leaseMs)) s.waitUntil(refresh(s, snapshot));
    return s.respond(snapshot, failing);
  }

  if (await store.tryLease(now, LIVE.leaseMs)) {
    const fresh = await refresh(s, snapshot);
    if (fresh) return s.respond(fresh, false);
  }
  return snapshot ? s.respond(snapshot, true) : unavailable();
}

export interface StatusDeps {
  store: Store<Snapshot>;
  tfl: () => TflClient;
  reference: ReferenceFile;
  now: number;
  waitUntil: (p: Promise<unknown>) => void;
}

export interface LinesDeps extends Omit<StatusDeps, 'store'> {
  store: Store<LinesSnapshot>;
  /** The check-all snapshot, read (never refreshed) to show recent verdicts on the home screen. */
  checks: Store<Snapshot> | null;
}

function respondChecks(snapshot: Snapshot, now: number, stale: boolean): Response {
  const body: StatusBody = { ...snapshot, serverNow: now, stale };
  return json(body, { headers: { 'Cache-Control': `public, max-age=${maxAge(snapshot.checkedAt, now)}` } });
}

export function summarise(snapshot: Snapshot | null, now: number): CheckSummary | null {
  if (!snapshot || now - snapshot.checkedAt > CHECKS_SHOWN_FOR_MS) return null;
  return {
    checkedAt: snapshot.checkedAt,
    lines: Object.fromEntries(snapshot.lines.map((l) => [l.lineId, { verdict: l.verdict, reason: l.reason, summary: l.summary }])),
  };
}

async function respondLines(snapshot: LinesSnapshot, deps: LinesDeps, checksRead: Promise<Snapshot | null>, stale: boolean): Promise<Response> {
  const checks = summarise(await checksRead, deps.now);
  const body: LinesBody = { ...snapshot, serverNow: deps.now, stale, checks };
  return json(body, { headers: { 'Cache-Control': `public, max-age=${maxAge(snapshot.checkedAt, deps.now)}` } });
}

/** GET /api/checks: every line's live check. Only the "Check all lines" button calls this. */
export function handleStatus(deps: StatusDeps): Promise<Response> {
  return serve<Snapshot>({
    store: deps.store,
    now: deps.now,
    waitUntil: deps.waitUntil,
    build: (prev) => buildSnapshot(deps.tfl(), deps.reference, deps.now, prev),
    respond: (s, stale) => respondChecks(s, deps.now, stale),
  });
}

/** GET /api/lines: TfL statuses for the home screen, plus recent check-all verdicts if any. */
export function handleLines(deps: LinesDeps): Promise<Response> {
  // Read alongside the lines snapshot, not after it: one D1 round trip instead of two.
  const checksRead = deps.checks ? deps.checks.read().then((r) => r.snapshot, () => null) : Promise.resolve(null);
  return serve<LinesSnapshot>({
    store: deps.store,
    now: deps.now,
    waitUntil: deps.waitUntil,
    build: () => buildLinesSnapshot(deps.tfl(), deps.reference, deps.now),
    respond: (s, stale) => respondLines(s, deps, checksRead, stale),
  });
}

/** D1 is down: call TfL directly, memoised per isolate so a burst doesn't multiply calls. */
const memo = new Map<string, { at: number; snapshot: Versioned }>();
async function withoutStore<S extends Versioned>(
  key: string,
  now: number,
  build: (prev: S | null) => Promise<S>,
  respond: (s: S, stale: boolean) => Response | Promise<Response>,
): Promise<Response> {
  const hit = memo.get(key) as { at: number; snapshot: S } | undefined;
  if (hit && now - hit.at < LIVE.memoMs) return respond(hit.snapshot, false);
  try {
    const snapshot = await build(hit?.snapshot ?? null);
    memo.set(key, { at: now, snapshot });
    return respond(snapshot, false);
  } catch (err) {
    console.error('direct refresh failed:', redact(err instanceof Error ? err.message : String(err)));
    return hit ? respond(hit.snapshot, true) : unavailable();
  }
}

export function handleStatusWithoutStore(tfl: () => TflClient, reference: ReferenceFile, now: number): Promise<Response> {
  return withoutStore<Snapshot>(
    'checks',
    now,
    (prev) => buildSnapshot(tfl(), reference, now, prev),
    (s, stale) => respondChecks(s, now, stale),
  );
}

export function handleLinesWithoutStore(tfl: () => TflClient, reference: ReferenceFile, now: number): Promise<Response> {
  return withoutStore<LinesSnapshot>(
    'lines',
    now,
    () => buildLinesSnapshot(tfl(), reference, now),
    (s, stale) => json({ ...s, serverNow: now, stale, checks: null } satisfies LinesBody, { headers: { 'Cache-Control': 'no-store' } }),
  );
}

export function resetMemoForTests() {
  memo.clear();
}

/** Upper bound on TfL calls for a check-all refresh: status + detail + one per check stop. */
export function plannedCalls(reference: ReferenceFile): number {
  const stops = new Set(reference.lines.filter((l) => !l.statusOnly).flatMap((l) => l.stations.map((s) => s.stopId)));
  return Math.min(LIVE.maxCallsPerRefresh, 2 + stops.size);
}
