import { SNAPSHOT_VERSION } from '../shared/api';
/**
 * Keyed snapshots ("lines", "checks") with a refresh lease each (ADR-002/006/009/011). The D1 implementation is the real one; MemoryStore has the
 * same semantics for tests. A successful refresh costs 2 D1 row writes: the lease and the snapshot.
 */
/** Anything stored: versioned so a shape from an older deploy is ignored and refreshed. */
export interface Versioned {
  version: number;
  checkedAt: number;
}

export interface StoredSnapshot<S extends Versioned = Versioned> {
  snapshot: S | null;
  /** Last failed refresh attempt (epoch ms), if any. */
  failedAt: number | null;
}

/** One keyed snapshot ("lines" or "checks") with its own lease. */
export interface Store<S extends Versioned = Versioned> {
  read(): Promise<StoredSnapshot<S>>;
  /** Atomically take the refresh lease if it has expired. Only the winner refreshes. */
  tryLease(now: number, leaseMs: number): Promise<boolean>;
  /** Save a good snapshot. The lease is left to expire (one write fewer). */
  write(snapshot: S): Promise<void>;
  /** Record a failed refresh and release the lease. Never touches the last good snapshot. */
  markFailed(now: number): Promise<void>;
}

export class D1Store<S extends Versioned> implements Store<S> {
  constructor(
    private readonly db: D1Database,
    private readonly key: 'lines' | 'checks',
    private readonly version: number,
  ) {}

  async read(): Promise<StoredSnapshot<S>> {
    const row = await this.db
      .prepare('SELECT body, failed_at FROM snapshots WHERE key = ?1')
      .bind(this.key)
      .first<{ body: string; failed_at: number | null }>();
    const parsed = row ? (JSON.parse(row.body) as S) : null;
    const snapshot = parsed && parsed.version === this.version ? parsed : null;
    return { snapshot, failedAt: snapshot ? (row?.failed_at ?? null) : null };
  }

  async tryLease(now: number, leaseMs: number): Promise<boolean> {
    const r = await this.db
      .prepare('INSERT INTO leases (key, until) VALUES (?3, ?1) ON CONFLICT (key) DO UPDATE SET until = ?1 WHERE until < ?2')
      .bind(now + leaseMs, now, this.key)
      .run();
    return r.meta.changes === 1;
  }

  async write(snapshot: S): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO snapshots (key, checked_at, failed_at, body) VALUES (?1, ?2, NULL, ?3) ON CONFLICT (key) DO UPDATE SET checked_at = excluded.checked_at, failed_at = NULL, body = excluded.body',
      )
      .bind(this.key, snapshot.checkedAt, JSON.stringify(snapshot))
      .run();
  }

  async markFailed(now: number): Promise<void> {
    await this.db.batch([
      this.db.prepare('UPDATE snapshots SET failed_at = ?1 WHERE key = ?2').bind(now, this.key),
      this.db.prepare('UPDATE leases SET until = 0 WHERE key = ?1').bind(this.key),
    ]);
  }
}

export class MemoryStore<S extends Versioned = Versioned> implements Store<S> {
  constructor(private readonly version: number = SNAPSHOT_VERSION) {}
  snapshot: S | null = null;
  failedAt: number | null = null;
  leaseUntil = 0;
  writes = 0;

  async read(): Promise<StoredSnapshot<S>> {
    const copy = this.snapshot && structuredClone(this.snapshot);
    const snapshot = copy && copy.version === this.version ? copy : null;
    return { snapshot, failedAt: snapshot ? this.failedAt : null };
  }
  async tryLease(now: number, leaseMs: number): Promise<boolean> {
    if (this.leaseUntil >= now) return false;
    this.writes++;
    this.leaseUntil = now + leaseMs;
    return true;
  }
  async write(snapshot: S): Promise<void> {
    this.writes++;
    this.snapshot = structuredClone(snapshot);
    this.failedAt = null;
  }
  async markFailed(now: number): Promise<void> {
    if (this.snapshot) this.failedAt = now;
    this.leaseUntil = 0;
  }
}
