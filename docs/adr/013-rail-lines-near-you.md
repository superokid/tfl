# ADR-013: Rail lines near you, worked out on the phone

## Context
User request: "add a button use my current location to filter" → the rail tabs' line list.

## Decision
- "Lines near me" on each rail tab filters it to lines at the closest stations (≤ 4 within 800 m; if none,
  the closest one up to 5 km; else every line). Numbers in `NEAR_LINES` (`config.ts`).
- Station positions come from route sequences (`lat`/`lon` on every stop, checked live) into
  `stations.json` and `/api/index`; a hub is the middle of its stops.
- Distances are computed on the phone: the position is never sent, no TfL calls, no Worker requests beyond
  the already-cached index. Off by default, no auto-locate: a filter that hides lines must be asked for.

## Consequences
- `/api/index` grows by ~10 KB raw (≈ 3 KB gzipped), cached a day.
- Straight-line distance, not walking distance.
