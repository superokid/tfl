# ADR-003: Rail lines checked automatically, bus routes checked on search

## Context
There are 21 rail lines and 700+ bus routes, a 50-subrequest limit per invocation and 500 TfL calls/min.

## Decision
- **Rail:** every line on every refresh. One arrivals call per check station covers every line there.
  Capped at 40 calls. The Cable Car is status-only (no predictions).
- **Bus:** checked on search (~3 calls), cached per route.
- Global budget of 400 TfL calls/min.

## Alternatives
| Option | Why not |
|---|---|
| All bus routes automatically | ~1,400 calls per refresh |
| Skip buses | Brief covers all lines |
| `/Line/{id}/Arrivals` | Payload too big for 10 ms CPU |

## Consequences
- Every line is covered within the free tier.
- Bus thresholds may need tuning (bunching).
- Bus search is cut first if time runs short.
