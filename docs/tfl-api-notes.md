# TfL API notes

Verified against the live API (fixtures in `test/fixtures/`, re-capture with `bun scripts/capture-fixtures.ts`).
`app_key` is a query parameter, so request URLs are secret.

**Lines** `/Line/Mode/tube,elizabeth-line,dlr,overground,tram,cable-car`
- 21 lines. Cable Car id is `london-cable-car`; Elizabeth line id is `elizabeth`.

**Status** `/Line/Mode/{modes}/Status`
- A line can have several statuses (Bakerloo: Severe Delays + Part Suspended).
- `isNow` is unreliable: Waterloo & City Planned Closure 04:15–23:59 showed `isNow=false` at 12:12. Use the dates (UTC, `Z`).
- Good Service has no validity periods.
- `affectedStops` is empty unless `?detail=true` (≈ 300 KB for all rail lines). It **includes the boundary
  stops**: "no service between Queen's Park and Harrow" lists Queen's Park.
- Rail severities include "Exit Only", "Bus Service" and "No Service" (all mapped; see SPEC §5.1).

**Overnight** (checked Mon 01:12): every rail line but the Cable Car says "Service Closed", valid from
~00:50 to 04:07 UTC whatever the line's first train. The reason gives no time ("Service will resume later
this morning"), except Waterloo & City ("…resume at 06:00"). Elizabeth line still had live predictions at
Ealing Broadway. Tram stays "Service Closed" while its timetable runs to ~01:30.

**Arrivals** `/Line/{ids}/Arrivals/{stop}`
- Several lines per call works. 1–17 KB per call.
- `direction` (inbound/outbound) is often null on sub-surface lines and the Bakerloo (10/21 at Earl's Court).
  `platformName` ("Northbound - Platform 4") then names the direction; the same platform appears with a
  direction on other vehicles in the same response.
- Elizabeth ("A"/"B") and DLR ("Platform 1") platforms have no compass word; `direction` is set there.
- **Ghost vehicles:** inside the live Bakerloo suspension, Harlesden and Willesden Junction showed vehicles
  with no destination, no direction and `towards: "Check Front of Train"`. Boundary stop Queen's Park
  showed northbound trains terminating there and southbound trains starting there. Rules handle both
  (SPEC §5.2).
- Missing destination in normal service is rare (3/21 at Earl's Court).
- Horizon varies: Victoria at Oxford Circus ~17 min; Elizabeth at Bond St ~118 min; **DLR only 2–13 min**
  (Limehouse ~5), so DLR is often too short to judge (`short-horizon`).
- Cable Car: `/Line/london-cable-car/Arrivals` → 404. Status-only.
- `/Line/{id}/Arrivals` (no stop) answers 200 for the whole line, under 75 KB, parse < 1 ms. Unproven as a
  replacement for per-stop calls: checked only after midnight (Victoria 1 prediction, Northern 0; the
  per-stop calls were empty too). Re-check in service hours.

**Route sequence** `/Line/{id}/Route/Sequence/{direction}`
- `orderedLineRoutes[].naptanIds` lists each route's stops in order. Northern has 8 routes; Kennington and
  Camden Town are on all 8. Liberty has 3 stops in total.
- Northern 130 KB, District 144 KB.

**Timetable** `/Line/{id}/Timetable/{stop}?direction=…`
- Departures from that stop: `timetable.routes[].schedules[]` with `name` ("Monday - Thursday", "Friday",
  "Saturday (also Good Friday)", "Sunday") and `knownJourneys` (`hour`, `minute`; hour ≥ 24 after midnight,
  e.g. Victoria Friday until 26:57).
- Schedule names vary by line (checked 2026-11-09): Bakerloo, Circle, District, DLR, H&C use "Monday - Friday"
  and "Saturdays and Public Holidays" (plural); Metropolitan "Monday - Thursday", "Friday", "Saturdays and Public
  Holidays"; Tram "Monday to Friday", "Saturday"; Waterloo & City only "Monday - Friday" (no weekend service).
- Night Tube lines (Piccadilly, Victoria, Central, Jubilee, Northern): Friday and Saturday run past 27:00, and
  the Saturday and Sunday schedules start ~03:15–04:35, continuing the night before.
- Gaps are uneven where branches merge (checked 2026-11-09, Tram at East Croydon, Sunday): trams in pairs,
  `1, 6, 1, 7…` by day (median 3.5–4, longest 7); the last outbound trams run 01:01, 01:02, 01:17 (15 min).
  A median alone understates the wait; the reference keeps the longest gap too (ADR-016).
- A schedule can go missing: on 2026-11-08 Piccadilly (Acton Town, Arnos Grove, both directions) came back
  without "Monday - Thursday"; on 2026-11-09 it was there (380 journeys). The generator retries once and drops
  a direction with any Mon–Fri day unmapped.
- Several routes when branches pass the stop (Northern at Euston: 2).
- 318–506 KB, parse 1.2–1.5 ms. Some stop/direction pairs 404 (District at Earl's Court, outbound).
- **Elizabeth line and all Overground lines: 404.** Without `?direction=` it returns a disambiguation whose
  own links 404.

**Bus** `/Line/Mode/bus` ≈ 348 KB.

**Nearby stops** `/StopPoint?lat&lon&stopTypes=NaptanPublicBusCoachTram&radius=400&modes=bus&returnLines=true`
- 24 stops around Oxford Circus, sorted by `distance` (metres), ~100 KB raw. Fields used: `id`, `commonName`,
  `stopLetter`, `distance`, `lines[]`, and `additionalProperties` key `Towards`.
- Some stops have no `lines` (stands, unused stops): skipped. `stopLetter` can be odd (`->W`): shown only if
  1–3 letters or digits.
- `/StopPoint/{id1},{id2}/Arrivals` → 404: arrivals need one call per stop.
- A bus stop's arrivals carry its flag letter as `platformName` (`RC`) and a `towards` text, so the stop page
  needs no extra call. That `towards` can differ from the StopPoint `Towards` (RC: "Baker Street Or Great
  Portand Street" vs "Marble Arch Or Great Portland Street"); the letter matches.

**Stop positions** `/Line/{id}/Route/Sequence/{dir}`: every `stopPoint` has numeric `lat`/`lon` (checked
Central and Elizabeth; all 457 stations in the index got one). A hub's stops each carry their own.

## Still to verify
- How often `timing.read` advances; responses during a partial TfL outage.
- Key in a header instead of the URL.
