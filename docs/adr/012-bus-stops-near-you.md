# ADR-012: Bus tab starts from the stops near you

## Context
Passengers at a bus stop want "how long until my bus comes here?", not a route number. The Bus tab led with
route search. User request: "just put the station location, and show how many minutes for the next bus".

## Decision
- Bus tab order: saved stops and routes, then **Near you**. Stops and routes are found with the search box
  at the top of every page (a second box on the tab was dropped: two stacked boxes did the same thing).
- "Use my location" (no prompt on load; automatic only if the browser already allows it). The phone rounds
  the position to 3 decimals (~110 m × 70 m) before sending it; the Worker never logs it.
- `GET /api/nearby?lat&lon`: the 5 closest stops that some route serves, each with its next buses per route
  and destination. One request per minute while open, like every screen.

| Part | TfL calls | Cache |
|---|---|---|
| Stops in a cell (`/StopPoint?lat&lon&radius=400`) | 1 | edge, 1 day per cell (stops don't move) |
| Each stop's times (`/StopPoint/{id}/Arrivals`) | 1 × ≤ 5 | the same 30 s cache, limit and in-flight sharing as `/api/station` |

So a nearby screen costs at most 6 TfL calls cold, 0 within 30 s, ≤ 5 per 30 s after, and nothing for a stop
someone else just opened. No D1 writes.

## Alternatives
| Option | Why not |
|---|---|
| One TfL call for all nearby stops | `/StopPoint/{a,b}/Arrivals` returns 404; not supported |
| Client fetches each stop page | 5 Worker requests per minute instead of 1 |
| A map | ADR-004: text list, small bundle |

## Consequences
- `Permissions-Policy` now allows `geolocation=(self)`.
- Outside Greater London the phone says so and sends nothing; the Worker rejects it with 400 anyway.
