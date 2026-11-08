# ADR-002: D1 snapshot on the server, browser cache on the device

## Context
During a TfL outage, any visitor, including a first-time one, should see the last known status and
its age. A phone with no signal should still open the app.

## Decision
- **D1:** one snapshot row, overwritten. Shared cache, refresh lease, outage fallback.
- **HTTP cache:** `max-age = 15 − age`.
- **`localStorage`:** last good result.
- **Service worker:** app shell only, so the page opens offline.

## Alternatives
| Option | Why not |
|---|---|
| Browser cache only | Nothing for first-time visitors; no rate-limit protection |
| Workers KV | 1,000 writes/day free; eventually consistent |
| Cache API | Evictable, per data centre |
| Durable Object | A second store; the D1 lease does the same job |

## Consequences
- ≈ 18k D1 writes/day worst case, against 100k. D1 calls count as subrequests, so batch them.
- D1 down → fetch TfL directly, memoised per isolate for 15 s.
