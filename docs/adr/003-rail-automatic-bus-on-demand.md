# ADR-003: Rail lines checked automatically, bus routes checked on search

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
"Official line status" covers every TfL line, buses included. There are ~21 rail lines and 700+ bus
routes. Checking a line takes ~2 arrivals calls. A Worker invocation can make 50 subrequests, and TfL
allows 500 calls/min.

## Decision
- **Rail** (Tube, Elizabeth line, DLR, Overground, Tram, Cable Car): every line is checked on every
  refresh (~43 calls). The whole list fits on one screen.
- **Buses:** status is available for every route. A route is checked when a user searches for it
  (~3 calls), and cached per route like rail.
- A global per-minute **TfL call budget** (400/min) stops many bus searches from using up the limit
  for everyone.

## Alternatives considered
| Option | Why not |
|---|---|
| Check all bus routes automatically | ~1,400+ calls per refresh: over the subrequest limit and roughly 3× TfL's per-minute limit. |
| Rail only, skip buses | Leaves out lines the brief covers. |
| Bus status without checking | Shows the status but not whether it's true, which misses the point of the tool. |

## Consequences
- Every TfL line is covered within free-tier limits.
- A list of 700 routes can't be scanned anyway, so searching is the natural way to reach a bus route.
- Bus search is the first feature to cut if time runs short; if it is cut, the README says so.
- The same rules engine serves both modes; only the trigger differs.
