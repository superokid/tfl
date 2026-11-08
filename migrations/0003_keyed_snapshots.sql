-- ADR-011: the home screen (statuses) and "Check all lines" (verdicts) are separate snapshots, each with
-- its own lease. Same costs per refresh as before: 1 lease write + 1 snapshot write.
CREATE TABLE snapshots (
  key TEXT PRIMARY KEY,
  checked_at INTEGER NOT NULL,
  failed_at INTEGER,
  body TEXT NOT NULL
);

CREATE TABLE leases (
  key TEXT PRIMARY KEY,
  until INTEGER NOT NULL
);

DROP TABLE IF EXISTS snapshot;
DROP TABLE IF EXISTS refresh_lease;
