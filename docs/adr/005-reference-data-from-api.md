# ADR-005: Reference data from the TfL API, not hardcoded

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
The rules need, for each line: which lines exist, which stations to check, and the normal gap between
services. Hardcoding these is fast but brittle. For example, when the Overground was split into six
named lines in 2024, a hardcoded list would have gone wrong silently.

## Decision
- **Line list:** `/Line/Mode/{modes}`.
- **Check stations:** chosen automatically from each line's route sequence. 2 stations served by every
  branch (or the most branches), at least 2 stops from either end, spread apart.
- **Normal gap per time band:** derived from TfL's timetable.
- Stored in D1 with `fetchedAt`, and refreshed by an hourly Cron Trigger when older than 24 h, in batches
  that stay under 50 subrequests. Bus routes are fetched on first search and kept for 24 h.
- **`overrides.ts`** corrects automatic choices where they're wrong. Each entry has a reason, and the
  README lists them.
- If a normal gap can't be derived, a documented **per-mode default** is used and the fallback is recorded.

## Alternatives considered
| Option | Why not |
|---|---|
| Hardcoded config table | Goes out of date silently, isn't credible for "all lines", and has to be maintained by hand. |
| Learn normal gaps from observed history | Needs polling and time to build up a baseline, which conflicts with ADR-001. Could complement the timetable later. |
| Fetch reference data during the user's request | Adds latency and subrequests to the hot path, competing with the 50-call limit. |

## Consequences
- New, renamed or closed lines are picked up automatically within a day.
- Timetable parsing is the riskiest part of the build; the per-mode fallback keeps the tool working if
  it slips.
- A background cron job exists, but only for reference data. Live data stays request-driven (ADR-001).
