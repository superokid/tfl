/**
 * Snapshot, refresh lease and TfL call budget (ADR-002/006). The D1 implementation is the real one;
 * MemoryStore has the same semantics for tests.
 */
import { SNAPSHOT_VERSION, type Snapshot } from '../shared/api';

/** A snapshot stored by an older deploy (different shape) counts as none, so it gets refreshed. */
const current = (s: Snapshot | null) => (s && s.version === SNAPSHOT_VERSION ? s : null);

export interface StoredSnapshot {
  snapshot: Snapshot | null;
  /** Last failed refresh attempt (epoch ms), if any. */
  failedAt: number | null;
}

export interface Store {
  read(): Promise<StoredSnapshot>;
  /** Atomically take the refresh lease if it has expired. Only the winner refreshes. */
  tryLease(now: number, leaseMs: number): Promise<boolean>;
  /** Atomically add `calls` to this minute's counter; false if that takes it over `max`. */
  reserveBudget(now: number, calls: number, max: number): Promise<boolean>;
  /** Save a good snapshot and release the lease. */
  write(snapshot: Snapshot): Promise<void>;
  /** Record a failed refresh and release the lease. Never touches the last good snapshot. */
  markFailed(now: number): Promise<void>;
}

const minuteOf = (now: number) => Math.floor(now / 60_000);

export class D1Store implements Store {
  constructor(private readonly db: D1Database) {}

  async read(): Promise<StoredSnapshot> {
    const row = await this.db
      .prepare('SELECT body, failed_at FROM snapshot WHERE id = 1')
      .first<{ body: string; failed_at: number | null }>();
    const snapshot = current(row ? (JSON.parse(row.body) as Snapshot) : null);
    return { snapshot, failedAt: snapshot ? (row?.failed_at ?? null) : null };
  }

  async tryLease(now: number, leaseMs: number): Promise<boolean> {
    const r = await this.db
      .prepare('UPDATE refresh_lease SET until = ?1 WHERE id = 1 AND until < ?2')
      .bind(now + leaseMs, now)
      .run();
    return r.meta.changes === 1;
  }

  async reserveBudget(now: number, calls: number, max: number): Promise<boolean> {
    const row = await this.db
      .prepare(
        'INSERT INTO tfl_budget (minute, calls) VALUES (?1, ?2) ON CONFLICT (minute) DO UPDATE SET calls = calls + excluded.calls RETURNING calls',
      )
      .bind(minuteOf(now), calls)
      .first<{ calls: number }>();
    return (row?.calls ?? Infinity) <= max;
  }

  async write(snapshot: Snapshot): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          'INSERT INTO snapshot (id, checked_at, failed_at, body) VALUES (1, ?1, NULL, ?2) ON CONFLICT (id) DO UPDATE SET checked_at = excluded.checked_at, failed_at = NULL, body = excluded.body',
        )
        .bind(snapshot.checkedAt, JSON.stringify(snapshot)),
      this.db.prepare('UPDATE refresh_lease SET until = 0 WHERE id = 1'),
      this.db.prepare('DELETE FROM tfl_budget WHERE minute < ?1').bind(minuteOf(snapshot.checkedAt) - 5),
    ]);
  }

  async markFailed(now: number): Promise<void> {
    await this.db.batch([
      this.db.prepare('UPDATE snapshot SET failed_at = ?1 WHERE id = 1').bind(now),
      this.db.prepare('UPDATE refresh_lease SET until = 0 WHERE id = 1'),
    ]);
  }
}

export class MemoryStore implements Store {
  snapshot: Snapshot | null = null;
  failedAt: number | null = null;
  leaseUntil = 0;
  budget = new Map<number, number>();

  async read(): Promise<StoredSnapshot> {
    const snapshot = current(this.snapshot && structuredClone(this.snapshot));
    return { snapshot, failedAt: snapshot ? this.failedAt : null };
  }
  async tryLease(now: number, leaseMs: number): Promise<boolean> {
    if (this.leaseUntil >= now) return false;
    this.leaseUntil = now + leaseMs;
    return true;
  }
  async reserveBudget(now: number, calls: number, max: number): Promise<boolean> {
    const total = (this.budget.get(minuteOf(now)) ?? 0) + calls;
    this.budget.set(minuteOf(now), total);
    return total <= max;
  }
  async write(snapshot: Snapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
    this.failedAt = null;
    this.leaseUntil = 0;
  }
  async markFailed(now: number): Promise<void> {
    if (this.snapshot) this.failedAt = now;
    this.leaseUntil = 0;
  }
}
