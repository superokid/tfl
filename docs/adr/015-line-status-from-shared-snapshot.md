# ADR-015: The line screen takes its status from the home screen's snapshot

## Context
`/api/line/:id` cost 3 TfL calls: the line's status plus arrivals at its 2 check stops. The status
duplicated what `/api/lines` already holds in D1 for every line, refreshed at most every 30 s. On a first
visit (nothing cached) a failed status call made the whole request a 503, even when arrivals answered.

## Decision
- The `lines` snapshot also stores TfL's parsed statuses per line (`statuses`, `LINES_VERSION` 2).
  `/api/lines` strips them from the response: the browser doesn't need them.
- When a line is checked, `/api/line/:id` reads that snapshot (refreshing it exactly as `/api/lines` does,
  lease included) alongside the arrivals calls. If it is under 90 s old (`LIVE.staleWhileRevalidateMs`),
  its statuses are used. Otherwise, or if D1 fails, the line calls TfL for its own status, as before.
- The per-instance limit is charged only for calls actually made.

## Consequences
- A line costs 2 TfL calls (its check stops), 3 only when the shared snapshot is old or unavailable.
- A TfL status failure no longer causes a 503 for a line while the shared snapshot is recent.
- One D1 read per line check (not per cache hit); the lease and a snapshot write when the snapshot is due.
- The status behind a verdict can be up to 90 s old, the same as the home screen shows.
- Not done: `/Line/{id}/Arrivals` (whole line, one call) might replace the per-stop calls. Tested at night
  with the tube closed only, so unproven (see `tfl-api-notes.md`).
