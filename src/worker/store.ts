/**
 * Snapshot and refresh lease (ADR-002/006/009). The D1 implementation is the real one; MemoryStore has the
 * same semantics for tests. A successful refresh costs 2 D1 row writes: the lease and the snapshot.
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
  /** Save a good snapshot. The lease is left to expire (one write fewer). */
  write(snapshot: Snapshot): Promise<void>;
  /** Record a failed refresh and release the lease. Never touches the last good snapshot. */
  markFailed(now: number): Promise<void>;
}

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

  async write(snapshot: Snapshot): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO snapshot (id, checked_at, failed_at, body) VALUES (1, ?1, NULL, ?2) ON CONFLICT (id) DO UPDATE SET checked_at = excluded.checked_at, failed_at = NULL, body = excluded.body',
      )
      .bind(snapshot.checkedAt, JSON.stringify(snapshot))
      .run();
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
  writes = 0;

  async read(): Promise<StoredSnapshot> {
    const snapshot = current(this.snapshot && structuredClone(this.snapshot));
    return { snapshot, failedAt: snapshot ? this.failedAt : null };
  }
  async tryLease(now: number, leaseMs: number): Promise<boolean> {
    if (this.leaseUntil >= now) return false;
    this.writes++;
    this.leaseUntil = now + leaseMs;
    return true;
  }
  async write(snapshot: Snapshot): Promise<void> {
    this.writes++;
    this.snapshot = structuredClone(snapshot);
    this.failedAt = null;
  }
  async markFailed(now: number): Promise<void> {
    if (this.snapshot) this.failedAt = now;
    this.leaseUntil = 0;
  }
}
