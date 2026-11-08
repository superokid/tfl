# ADR-014: Limit on-demand endpoints per client IP

## Context
The TfL key allows 500 requests/min in total. The on-demand limit (60 TfL calls/min) is per Worker instance,
so many instances together can exceed it. `/api/search`, `/api/station/490…` and `/api/nearby` accept
unbounded inputs, so an attacker can miss the edge cache on every request. If the key is throttled,
every user gets `CANT_VERIFY` or 503. WAF rate-limiting rules need a custom domain (ADR-009).

## Decision
- Workers Rate Limiting binding `IP_LIMITER`, keyed by `CF-Connecting-IP`: 60 requests/60 s.
- Applied before `/api/line/*`, `/api/station/*`, `/api/bus/*`, `/api/search` and `/api/nearby`.
  `/api/lines` and `/api/checks` are already capped by the lease, and `/api/health` and `/api/index` make no TfL call.
- Over the limit: `429 {"error":"rate_limited"}`, `Retry-After: 60`, `no-store`.
- If the binding errors, the request is let through and the error is logged.

## Consequences
- One IP can cause at most about 60 on-demand requests/min at each location, well under TfL's limit.
- Counts are per Cloudflare location and eventually consistent, so this isn't a global cap. Many IPs
  together (a botnet) can still exhaust the key. A strict cap would need a Durable Object.
- Users behind a shared IP (CGNAT, offices) share the 60 requests. The app fetches per screen and doesn't
  poll on-demand data, so 60/min is generous for one person.
- The binding call is counted as 1 subrequest in the budget, to be safe.
