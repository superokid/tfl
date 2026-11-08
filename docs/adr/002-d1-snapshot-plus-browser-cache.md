# ADR-002: D1 snapshot on the server, browser cache on the device

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
The tool must survive TfL outages and repeated requests. During an outage, **anyone** opening the app,
including a first-time visitor, should see the last known status and how old it is.

## Decision
- **D1** stores the latest good snapshot, with a timestamp (one row, overwritten). It's the shared cache
  for ADR-001 and the fallback during outages.
- **HTTP caching** (`Cache-Control: max-age=15`) makes repeat loads on the same device instant.
- **`localStorage`** keeps the last good result on the device, for a bad phone signal or offline use.

## Alternatives considered
| Option | Why not |
|---|---|
| Browser cache only | First-time visitors get nothing during an outage. Each browser fetches TfL separately, so there's no rate-limit protection. Gone after clearing data or in private mode. |
| Workers KV | Free tier allows 1,000 writes/day; a 15 s refresh can need ~5,760. KV is also eventually consistent (up to ~60 s). |
| Cache API | Cloudflare can evict entries at any time, and each data centre has its own copy, so it can't be relied on as an outage fallback. |
| Durable Object | Would also coalesce concurrent fetches, but adds complexity we don't need at this scale. Worth revisiting if the race in ADR-001 matters. |

## Consequences
- Outage fallback works for every visitor, globally.
- D1 usage stays tiny: at most ~6k writes/day against a 100k limit, and one row.
- D1 is a single region (`weur`, close to London users and TfL): about 10–30 ms per read.
- If D1 itself fails, the API falls back to fetching TfL directly, and the browser falls back to `localStorage`.
