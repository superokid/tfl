# ADR-005: Reference data from the TfL API, not hardcoded

> Storage and refresh superseded by [ADR-007](007-generated-reference-data.md) (Phase 1 measurements).

## Context
The rules need lines, check stations, normal gaps and operating hours. Hardcoding goes stale silently
(e.g. the 2024 Overground split).

## Decision
- Lines from `/Line/Mode/{modes}`; check stations from the route sequence.
- Normal gaps and hours from `/Line/{id}/Timetable/{stop}?direction=…` `knownJourneys`, per day type and
  time band. (`FrequencyMinutes` is too coarse.)
- Stored in D1, refreshed hourly by cron when > 24 h old, one timetable per step.
- If parsing exceeds 10 ms CPU, derive in a scheduled GitHub Action instead.
- `overrides.ts` fixes wrong automatic choices, each with a reason.
- Missing gap → per-mode default. A default can never produce a mismatch.

## Alternatives
| Option | Why not |
|---|---|
| Hardcoded table | Goes stale, hand-maintained |
| Learn from history | Needs polling (ADR-001) |
| Fetch on request | Latency and subrequests on the hot path |

## Consequences
- New or renamed lines appear within a day.
- Timetable parsing is the main risk; it's measured in Phase 1.
