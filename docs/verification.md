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

## 2026-11-08, live arrivals boards
- Victoria flagged live: "an 8-minute gap between northbound trains at Tottenham Hale, starting in 12 minutes
  (usually 2)"; the board beside it shows northbound trains at 11 then 19 min, and Vauxhall southbound at
  4 then 12, so the claim can be checked by eye. Raw TfL arrivals confirmed the gap (750 s → 1230 s).
- Bakerloo shows TfL's full message and Waterloo's live board while North Wembley (inside the suspension)
  says "No services predicted".

## 2026-11-08, station search
- `/api/station/HUBSRA` (Stratford): 1.2 s cold, 18 ms cached; unknown id → 404; index 457 stations, cached a day.
- Found live: TfL lists Elizabeth line Gidea Park trains (platform 8, eastbound) as `direction: outbound`,
  together with westbound Paddington trains on platform 5. Boards now group by platform.
- Euston, Bank and Stratford boards read like station departure boards (branch platforms apart, terminating
  trains marked).

## 2026-11-08, Phase 7 hardening (production build via `vite preview`)

| Check | Result |
|---|---|
| Security headers | Page: strict CSP (`script-src 'self'`, no inline scripts), `frame-ancestors 'none'`, nosniff, no-referrer, COOP. API: `default-src 'none'`. Hashed assets `immutable`. |
| Lighthouse mobile | Performance 92 · Accessibility 100 · Best practices 100 · SEO 100 (FCP 2.2 s, LCP 2.8 s, TBT 80 ms, CLS 0.072). First run found an invalid `aria-controls` and a missing `robots.txt`; both fixed. |
| Load: `bun scripts/load.ts` 75 s, 20 concurrent, 90% status / 10% station | 7,591 requests (101/s), 0 errors, 0 stale; p50 161 ms, p95 291 ms, max 5.2 s (one cold refresh). **4 line refreshes** (limit 4), **9 station fetches** for 3 stations. |
| Spot-check vs tfl.gov.uk status page | Bakerloo "Severe delays · Part suspended", Central "Minor delays", Lioness "Reduced service", Waterloo & City "Planned closure": same as `/api/status`. |

**Found by the load test:** station cache expiry under load caused a stampede (38 fetches, 5 × 503).
Concurrent requests for a station now share one in-flight fetch.

## 2026-11-08, passenger-first redesign (ADR-011), dev server against live TfL
| Check | Result |
|---|---|
| `/api/lines` cold | 1.95 s, 5 KB (was ~6 s): 1–2 TfL calls, no arrivals |
| `/api/line/victoria` | 1.3 s, 3 KB; `/api/station/490000173RC` (bus stop) 0.3 s; `/api/bus/38` 3.3 s cold |
| Phone screenshots, 360 px, light + dark (CDP-driven, incl. typing in search) | Home, line, station, bus stop, bus route, bus tab, search for "oxford" and "38" |
| Found and fixed in screenshots | Horizontal overflow from the tab bar; Bus tab off-screen; bus destinations truncated; duplicate station heading |
| Status ranking | Bakerloo "Severe Delays + Part Suspended" ranks as part-suspended (worse), as on TfL's site |
