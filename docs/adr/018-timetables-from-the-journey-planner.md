# ADR-018: Timetables from the journey planner for the Elizabeth line and Overground

## Context
TfL's `/Timetable` is 404 for the Elizabeth line and every Overground line, so they ran on the per-mode
fallback gap and could never be flagged (the rule that keeps a guessed gap from raising a mismatch).
TfL's journey planner does have their planned trains: 3 journeys per call, with a "later" link to page on.

Checked live (9 Nov 2026):
- Tram, East Croydon → next stop, a whole Sunday: all 252 timetabled departures found (plus 3 early extras).
- Elizabeth line, Ealing Broadway westbound: 4 trains an hour skip West Ealing. Planning to West Ealing alone
  found 111; adding Hayes & Harlington (all westbound routes stop there) found 188. The midday pattern
  (8, 3, 4, 8, 7 min) matched live arrivals.
- Eastbound from Ealing Broadway most trains skip Acton Main Line, and the routes then split (Paddington main
  line, or the tunnel), so no shared station sees them: the first run gave a 15 min median against 4–6 live.
  Adding each route's last station found 189 a day, matching live.

## Decision
- When a line has no TfL timetable at any check station, `bun run reference` pages the journey planner
  from each check station, per direction, to each route's next station, the furthest station all routes
  share and each route's last station, and merges the departures (one per minute).
- Sampled days: a Tuesday (Mon–Thu), Friday, Saturday and Sunday, at least 2 days ahead (planned, not live).
  A day with too few trains (closures, replacement buses) is retried a week later; if it fails again the
  direction gets no reference (fallback gap, `CANT_VERIFY`), never a false "closed".
- The departures go through the same hourly median and longest gap as TfL timetables (ADR-016).
- Settings in `JOURNEYS` (`config.ts`); parsing in `src/shared/reference/journeys.ts` (pure, tested).

## Consequences
- These lines can now be flagged, judged like any other.
- `bun run reference` takes much longer (thousands of journey planner pages; see `docs/verification.md`).
- Engineering works for part of a sampled day aren't detected: hours or gaps that day can be off until the
  next regeneration. A bank holiday on a sampled day would give that day's service; regenerate if so.
- A train that terminates at the check station is in live arrivals but not in planned departures: gaps can
  look shorter live than planned, which only makes a flag less likely.
