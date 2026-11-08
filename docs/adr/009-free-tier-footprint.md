# ADR-009: Stay small on a free Cloudflare account shared with other sites

## Context
Free-plan limits are **daily and account-wide**: 100k Worker requests and 100k D1 rows written per day,
shared with the owner's other sites. Static asset requests are free and unlimited; only `/api/*` runs the
Worker.

## Decision
| Lever | Setting |
|---|---|
| Line refresh | At most every 30 s (TfL's own update rate), only when someone asks |
| D1 writes per refresh | 2 (lease + snapshot); the lease expires instead of being released |
| TfL budget table | Dropped (migration 0002): the lease already caps refreshes |
| Station lookups | 30 s edge cache + in-memory per-instance limit (60 calls/min); no D1 writes |
| Client polling | Every 60 s while visible; stops after 10 min without interaction |

## Consequences
- Worst case, someone watching 24 h: ≤ 5,760 D1 writes/day (~6% of the shared limit); 0 when idle.
- Worker requests: ~1/min per active visitor, ≤ ~10 per idle tab; page loads are free.
- Data is up to 30 s old (was 15 s), still within TfL's own refresh cycle.
- Not covered: deliberate abuse of `/api/*` still counts against the account. Rate-limiting rules need a
  custom domain; the strongest isolation is a separate free Cloudflare account for this app.
