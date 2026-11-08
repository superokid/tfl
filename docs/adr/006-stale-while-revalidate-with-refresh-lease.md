# ADR-006: Stale-while-revalidate with a D1 refresh lease

## Context
A refresh is ~40 calls through 6 connections, so it takes seconds. Every open tab refreshes every 30 s,
so many requests miss the cache at once, and each would call TfL.

## Decision
- < 15 s: serve the snapshot. 15–60 s: serve it, and refresh in `waitUntil`. > 60 s: refresh inline.
- Only the request that wins a D1 lease row (`UPDATE … WHERE until < now`, `changes() = 1`) refreshes.
- A limiter keeps at most 6 calls in flight; each timeout starts at send.
- The budget counter is atomic and reserved before a refresh.

## Alternatives
| Option | Why not |
|---|---|
| Refresh inline always | Seconds of waiting |
| Accept the race | Many refreshes at once |
| Durable Object | A second store for the same result |
| Fire all calls at once | Queued calls time out unsent |

## Consequences
- Most requests are one D1 read.
- Data can be up to ~60 s old; the UI shows its age.
- A crashed refresher's lease expires after 20 s.
- `/api/line/:id` uses the same windows over its edge cache (< 30 s, 30–90 s, older), without a lease:
  concurrent requests in an isolate share one fetch.
