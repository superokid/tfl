# ADR-001: Fetch live data on request, not by polling

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
The tool must be "right on live data". Live TfL status and arrivals change constantly, and TfL refreshes
its predictions roughly every 30 seconds. We run on the Cloudflare free tier (50 subrequests per
invocation, 10 ms CPU), and TfL allows 500 requests/min per key.

## Decision
Live status and arrivals are fetched from TfL **when a user requests them**. The result is reused for up
to **15 seconds** (stored in D1, see ADR-002). No scheduled job polls live data.

Slow-changing reference data (line lists, check stations, normal frequencies) *is* refreshed in the
background (see ADR-005). That data changes daily at most, and fetching it during a user's request would
add latency.

## Alternatives considered
| Option | Why not |
|---|---|
| Cron polling every 1–2 min | Data can be up to a polling interval old; spends API calls and D1 writes even when nobody is looking. |
| No cache at all (fetch every request) | Fetching more often isn't fresher, because TfL itself updates about every 30 s. ~43 calls per page load would exhaust the 500/min limit at ~11 loads/min, and every load would wait 1–2 s on TfL. |
| 1 s cache | Same data as a 15 s cache in practice; one user holding refresh could use most of the rate limit. |

## Consequences
- Data is never older than about 15 s plus TfL's own refresh cycle.
- TfL usage scales with time, not traffic: at most ~4 refreshes/min, ≈ 170 calls/min worst case.
- The first request after the cache expires takes the TfL round trip (~1–2 s); later ones take about 50 ms.
- Two simultaneous cache misses can both fetch. That's accepted and documented.
- The freshness window is one config value and can be tuned.
