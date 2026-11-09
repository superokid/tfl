# Verification log

What was checked against live TfL data, and what it changed. Newest first.

## 2026-11-09, home checks the open tab (ADR-017), dev server against live TfL (Mon 08:06)
- `/api/checks/:tab`: Tube 1.7 KB, 6.9 s cold, then 28 ms from D1; Elizabeth 0.7 s; Overground 5.2 s;
  DLR 0.5 s; Tram 0.4 s. Each returned only its own lines; `/api/checks/bus` → 404; `/api/lines` has no verdicts.
- Home at 360 px (headless Chromium): every Tube row shows "Live trains match" or "Live trains not checked".
- Peak-hour Tube: 5 match, 4 "mixed signals", Bakerloo and Waterloo & City too little data. Overground:
  Liberty and Mildmay can't be judged (no timetable, ADR-005 fallback).

## 2026-11-09, tram false alarm (ADR-016)
- Reported: Tram flagged at East Croydon on Sunday night, 14 min gap; TfL's Sunday timetable has 15 there.
- Live timetable: last outbound trams 01:01, 01:02, 01:17. At ~00:50 the rule used the 00:00 hour's median
  (6, threshold 12) for the whole look-ahead. Daytime trams run in pairs (median 4, longest 7): the
  8 Nov 9.4 min "disruption" was the same cause.
- Fixed: each gap judged against the timetable hours it overlaps, `max(2 × median, longest + 5)`. Tests
  reproduce both cases (now `MATCH`), and a 14 min gap in 6–8 min service is still flagged.
- Regenerated `rail.json` by day: platform compass words are now learnt for most lines (the last run was at
  01:19, with no trains); Circle medians at Edgware Road and Notting Hill Gate changed with TfL's timetable.

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
- Bus tab "Near you", live, Oxford Circus (emulated location, Playwright at 360 px): 5 stops (RC 42 m, RG 51 m,
  JC, RF, OH) with next buses; no horizontal overflow, no console errors. Only `lat=51.515&lon=-0.142` left
  the phone. Returning with location already allowed loads stops without a tap. Paris → 400, no TfL call.
  The Bus tab no longer fetches `/api/lines`. Tests: 6 TfL calls cold, 0 within 30 s, 5 after; 10 viewers →
  one fetch per stop; a stop opened elsewhere costs nothing; coordinates never logged.
- Bus 38 route page, live: 44 + 45 stops with next buses, 2.1 s cold, 13 ms cached, 10 KB. Times progress
  along the route (5 → 6 → 9 → 11 min). Budget test: 4 TfL calls cold, 0 within 30 s, 2 after; 10
  concurrent viewers → 1 fetch.
