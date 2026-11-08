# ADR-001: Fetch live data on request, not by polling

## Context
Live data must be right. TfL updates predictions about every 30 s. Free tier: 50 subrequests
(D1 included), 6 connections at once, 10 ms CPU. TfL allows 500 req/min.

## Decision
Live status and arrivals are fetched only because a user requested them, and reused for 15 s via D1.
No timer polls live data. Reference data is refreshed by cron (ADR-005).

## Alternatives
| Option | Why not |
|---|---|
| Cron polling | Older data; spends calls when nobody is looking |
| No cache | Not fresher than TfL's ~30 s; ~12 page loads/min would exhaust the TfL limit |
| 1 s cache | Same data; one user can drain the limit |

## Consequences
- ≤ 4 refreshes/min, ≤ 160 TfL calls/min.
- A refresh takes seconds (40 calls through 6 connections); ADR-006 keeps it off the user's path.
