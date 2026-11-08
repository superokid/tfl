-- One snapshot row, overwritten (ADR-002). failed_at > checked_at means the last refresh failed.
CREATE TABLE snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  checked_at INTEGER NOT NULL,
  failed_at INTEGER,
  body TEXT NOT NULL
);

-- Only the request that moves `until` forward refreshes (ADR-006).
CREATE TABLE refresh_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  until INTEGER NOT NULL
);
INSERT INTO refresh_lease (id, until) VALUES (1, 0);

-- Global TfL calls per minute, reserved before a refresh.
CREATE TABLE tfl_budget (
  minute INTEGER PRIMARY KEY,
  calls INTEGER NOT NULL
);
