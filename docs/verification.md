# Verification log

What was checked against live TfL data, and what it changed. Newest first.

## 2026-11-08 (Sunday), local dev against live TfL

| Check | Result |
|---|---|
| Cold `/api/status` | 6.2 s (≈ 40 TfL calls, 6 in flight); next request 25 ms from D1, `max-age=9` |
| `bun run smoke http://localhost:5179` | `/api/health` and `/api/status` pass the schema check |
| UI at 320 px, 360 px, light and dark (headless Chromium) | Readable, no horizontal scroll; JS+CSS 71.7 KB gzipped (app 5.7 KB) |
| Every line's verdict read by hand | Led to the three rule changes below |

**Rule changes from live data**
- Bakerloo part-suspension: ghost vehicles inside the closed section and normal-looking service at the
  boundary stop → "running normally" now needs confirmed through-services in every direction.
- Lioness Part Closure: trains every 15 min at Bushey, inside the closure, showed as "Matches" →
  `MATCH` now needs every station to agree; one disagreeing station is "Mixed signals".
- Liberty (every 30 min, no TfL timetable): the "can't verify" sentence overstated the evidence → reworded.

**Observed, not changed (tuning input)**
- Tram flagged `HIDDEN_DISRUPTION`: East Croydon westbound 9.4 min gap and Sandilands 9.01 min against a
  9 min threshold (usual 4). Rule-correct but marginal; watch before tuning `thresholdExtraMin`.
- Sunday sub-surface gaps (Harrow-on-the-Hill 15 min vs 4) are genuine irregularity, shown as
  "Mixed signals".
- DLR predictions reach only 2–13 min ahead → mostly "Can't verify" (`short-horizon`).
- Elizabeth line and Overground have no TfL timetables → never flagged (fallback gap).
