# ADR-011: Each screen fetches only its own data, when opened

Refines ADR-001/006: still on request, never polled, but no longer "everything at once".

## Context
Every home-page refresh fetched arrivals for all 21 lines (~42 TfL calls, ~6 s cold) although a passenger
usually wants one line, one station or one bus. User request: "dont fetch everything at once, just fetch on
user request". Bus users had nothing to use.

## Decision
| Screen | Endpoint | TfL calls | Cache |
|---|---|---|---|
| Home: status per mode | `/api/lines` | 1–2 | D1 snapshot `lines` (outage fallback) |
| Line: live check + next trains | `/api/line/:id` | its check stops; status from `lines` ([ADR-015](015-line-status-from-shared-snapshot.md)) | edge 30 s, shared in-flight |
| Full check (no UI button) | `/api/checks` | ~42 | D1 snapshot `checks`; home showed its verdicts for 10 min (replaced by [ADR-017](017-home-checks-the-open-tab.md)) |
| Station or bus stop | `/api/station/:id` | 1–4 | edge 30 s |
| Bus route: status + next buses at every stop | `/api/bus/:route` | 2 (+2 for stop order, cached a day) | edge 30 s, shared in-flight |
| Bus stop search | `/api/search?q=` | 1 per new query | edge 1 day |
| Bus stops near you ([ADR-012](012-bus-stops-near-you.md)) | `/api/nearby?lat&lon` | 1 + ≤ 5 | stop list 1 day, times 30 s |
| Search index | `/api/index` | 0 (generated) | browser 1 day |

UI: mode tabs (Tube · Elizabeth line · Overground · DLR · Tram · Bus), TfL's status in plain words first, the
live check as a short note only when it adds something, one search box for stations, bus stops and routes,
saved favourites on the device.

## Alternatives
| Option | Why not |
|---|---|
| Keep the all-lines refresh behind the home page | ~42 calls per refresh; slow cold start; mostly unused |
| All bus statuses in one call | ~800 KB, 18 s when measured |

## Consequences
- Home cold load ~2 s (was ~6 s); a line ~1.3 s; a bus stop ~0.3 s.
- The home page only showed mismatches from a check-all under 10 min old, which no screen ran: in practice
  never. [ADR-017](017-home-checks-the-open-tab.md) checks the open tab instead.
- Snapshots and leases are keyed (`lines`, `checks`; migration 0003); costs per refresh unchanged (2 writes).
