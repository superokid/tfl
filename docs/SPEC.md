# Spec: TfL Status vs Reality

> Source of truth for behaviour. Reasons: [`adr/`](adr/). API facts: [`tfl-api-notes.md`](tfl-api-notes.md).
> If code and spec disagree, fix one in the same PR.

## 1. Goal

Show, in under a second on a phone, whether TfL's official line status matches what's really running.

Quality bar: correct on live data; survives outages and concurrent requests; tests on every push; no
keys in repo, logs, errors or browser; fast on a phone; real git history. A false "OK" is the worst
outcome, a false alarm the next worst.

## 2. Scope

- **Rail** (Tube, Elizabeth, DLR, Overground, Tram, Cable Car): checked on every refresh. Lines with no
  predictions (Cable Car) are status-only.
- **Bus:** checked when searched ([ADR-003](adr/003-rail-automatic-bus-on-demand.md)).
- **Out:** history, map ([ADR-004](adr/004-text-list-no-map.md)), accounts, branch-only disruptions
  (known limit).
- Nothing the API provides is hardcoded ([ADR-005](adr/005-reference-data-from-api.md)). Exceptions go
  in `overrides.ts` with a reason, listed in the README.

## 3. Platform

- TypeScript, React + Vite, one Worker (static assets + API), one D1 (`weur`). No UI library.
- Bundle < 80 KB gzipped; app code (excluding React) < 20 KB. Reported in CI.

| Free-tier limit | Consequence |
|---|---|
| 50 subrequests, **D1 included** | ≤ 40 TfL + ≤ 6 D1 calls; use `db.batch()` |
| 6 connections waiting at once | Limiter of 6; timeout starts at send |
| 10 ms CPU (cron too) | Small payloads only |
| `waitUntil` ≤ 30 s | Refresh deadline 20 s |
| D1 100k writes/day | ≈ 18k/day worst case |
| TfL 500 req/min | 15 s freshness, lease, budget |

## 4. Data

### 4.1 Live data: on request, never polled ([ADR-001](adr/001-fetch-on-request-not-polling.md), [ADR-006](adr/006-stale-while-revalidate-with-refresh-lease.md))

**`GET /api/status`**
1. One `db.batch()`: snapshot, lease, reference data.
2. < 15 s old → return it.
3. 15–60 s → return it; if the lease is won, refresh in `waitUntil`.
4. \> 60 s → if the lease is won, refresh inline; otherwise return it.
5. Lease: `UPDATE refresh_lease SET until = :now+20s WHERE id=1 AND until < :now`; refresh only if
   `changes() = 1`.
6. Refresh:
   - rail status, 1 call (no `?detail=true`)
   - `?detail=true` only for lines with a partial status
   - arrivals: 1 call per check station, `/Line/{ids}/Arrivals/{stop}`
   - ≤ 40 calls; lines over the cap → `CANT_VERIFY` ("call budget")
7. Run the rules, overwrite the snapshot row, return it.
8. Failures:
   - status call fails → stored snapshot, `stale: true`
   - arrivals call fails → reuse that line's verdict if < 2 min old, else `CANT_VERIFY`
   - invalid 200 body = failure
   - never overwrite a good snapshot with a failed fetch
   - no snapshot and TfL down → `503`, `no-store`
   - D1 down → fetch TfL directly, memoise per isolate for 15 s, log it
9. `Cache-Control: max-age = max(1, 15 − age)`. The response includes `checkedAt` and `serverNow`.

**`GET /api/bus/:routeId`:** `routeId` must be in the known route list, else `404`. Same pattern, one
row and lease per route. Calls: status + 2 stops.

**Budget:** an atomic per-minute counter in D1 (`… RETURNING count`), reserved before a refresh.
Above 400/min, serve stored data marked stale.

**Key:** `app_key` sits in the URL, so TfL URLs are secret. One helper builds them; one redacts them
before anything is logged, thrown or returned.

### 4.2 Storage ([ADR-002](adr/002-d1-snapshot-plus-browser-cache.md))

D1 snapshot (shared, outage fallback) · HTTP cache · `localStorage` (last good result) · service worker
(app shell only, never `/api/*`).

### 4.3 Reference data (cron, never on request)

- Lines: `/Line/Mode/{modes}`.
- Check stations: 2 per line, served by all (or most) branches, ≥ 2 stops from either end, spread
  apart; prefer interchanges.
- Normal gap per station × direction × day type × time band, plus first and last journey:
  - from `/Line/{id}/Timetable/{stop}?direction=…` `knownJourneys` (median gap)
  - day types from the schedule names
- Hourly cron refreshes entries > 24 h old, one timetable per step. Only derived numbers are stored.
- If parsing busts the CPU limit (measured in Phase 1), derive in a scheduled GitHub Action that writes
  to D1.
- Missing gap → per-mode default (at the frequent end), recorded as a fallback.
- Bus route ids: cron only. Bus reference data: fetched on first search, kept 24 h.

## 5. Rules

Pure function of (status, arrivals, reference data, `now`). No I/O, no `Date.now()`, `Europe/London`.
Code: `src/shared/rules/`. Input is the domain model in `types.ts`, not raw TfL JSON; parsing TfL into
it happens at the boundary (Phase 4), tested against real fixtures.
All numbers in `src/shared/config.ts`; tuning recorded in `docs/verification.md`.

### 5.1 Status → expected service (by description; every rail entry in `/Line/Meta/Severity` is covered)

| Expected | Descriptions |
|---|---|
| `NORMAL` | Good Service, No Issues, Information, No Step Free Access, Exit Only |
| `MINOR` | Minor Delays |
| `DEGRADED` | Severe Delays, Reduced Service, Change of Frequency, Issues Reported, Special Service |
| `PARTIAL` | Part Suspended, Part Closure, Part Closed, Diverted, Bus Service |
| `NONE` | Suspended, Not Running, No Service |
| `CLOSED` | Planned Closure, Service Closed, Closed |
| unknown | `CANT_VERIFY`, logged |

- Only statuses valid at `now` count, computed from the dates (`isNow` is unreliable).
- `PARTIAL` applies to its `affectedStops`; the other status applies elsewhere. Otherwise the most
  restrictive wins: `CLOSED` > `NONE` > `DEGRADED` > `MINOR` > `NORMAL`.

### 5.2 Definitions

- **Direction:** evaluated separately (`direction`, else `platformName`).
- **Predictions:** de-duplicated by vehicle. Gap checks count every prediction; "running normally" counts
  only confirmed (has a destination) services that don't terminate at the stop, and needs every direction
  usable (live ghost and boundary cases, see `tfl-api-notes.md`).
- **Prediction freshness:** If `timing.read` is > 3 min old, the feed is frozen and
  the direction is unusable.
- **Horizon:** the furthest prediction.
- **Window:** 30 min if normal gap ≤ 5 min, else 60 min, cut to the horizon.
- **Gap:** largest interval of now → first arrival and consecutive arrivals. Never after the last
  prediction.
- **Threshold:** `max(2 × normal, normal + 5 min)`.
- **Usable direction:** ≥ 1 prediction, and horizon ≥ 2 × normal or a gap over the threshold was seen.
  No predictions = unusable.
- **Day edges:** within 20 min of the first or last journey → `CANT_VERIFY`.
- **Also decided in Phase 2:**
  - Arrivals already due count as now.
  - If later arrivals exist beyond the window, the wait from the last in-window arrival to the window end
    counts as a gap.
  - A station in a `PARTIAL` status's affected stops is expected to have no service (`NONE`).
  - A direction with predictions but no timetable uses the per-mode fallback gap, with hours assumed open.

### 5.3 Verdicts

| Verdict | When |
|---|---|
| `HIDDEN_DISRUPTION` | Expected `NORMAL`/`MINOR`, and ≥ 2 stations have a usable direction over the threshold. |
| `STALE_ALERT` | Expected `NONE`, but ≥ 2 such stations have services within the threshold; or expected `DEGRADED`, but at ≥ 2 stations every gap is ≤ 1.5 × normal. |
| `MATCH` | ≥ 2 usable stations, and the evidence agrees with the status. |
| `CANT_VERIFY` | Failed, invalid, empty or frozen data; < 2 usable stations; unknown status; `PARTIAL` with no affected stops or no check station in them; status-only line; budget hit; mismatch based on a fallback gap. |
| `CLOSED` | Expected `CLOSED`, or outside timetable hours. Never a mismatch. |

- Ghost and boundary trains during a suspension: seen live in Phase 1 and ruled out (§5.2).
- Evidence: station, direction, normal gap (and whether it's a fallback), observed gap, horizon,
  time, and a sentence: *"TfL says Good Service, but the next southbound train at Euston is
  14 minutes away (usually 3)."*

## 6. UI

- **Header:** title, "updated 12s ago" (from `checkedAt`/`serverNow`), refresh button.
- **Mismatches first** (line-colour stripe, "TfL says / Services show", tap for evidence), then matches
  (collapsed), then `CANT_VERIFY`/`CLOSED` with reasons.
- **Bus:** route search with suggestions; recent routes in `localStorage`.

| State | Shows |
|---|---|
| Summary | "All 20 checkable lines match", or "18 of 21 match · 3 can't be checked" |
| Stale | "TfL isn't responding, showing information from 4 min ago" |
| No data | Message + retry |
| Night | "Most lines are closed, checks resume at HH:MM" (from the timetable) |
| Loading | Skeleton |
| Offline | Last `localStorage` result with its age |

- Auto-refresh every 30 s while visible.
- AA contrast, colour never the only signal, 320 px, dark mode.
- No TfL logo or endorsement. Credit "Powered by TfL Open Data".

## 7. Tests and CI

- **Fixtures:** trimmed live responses, from a capture script that never writes the key.
- **Rules:**
  - every verdict and every status mapping, unknown status, two statuses on one line
  - `isNow` wrong
  - frequent vs infrequent lines
  - horizon < window; now → first arrival as the gap
  - empty predictions at 1 vs 2 stations; frozen feed; Cable Car
  - Severe Delays with normal vs long gaps
  - night, day edges, non-operating day, planned closure, DST
  - Part Suspended with and without affected stops
  - fallback gap never gives a mismatch
- **Station selection:** branching lines use the shared section; interchanges preferred; ≤ 40 calls.
- **Data layer:**
  - fresh / recent / old snapshot
  - lease held
  - TfL down; partial failure; invalid body
  - budget exceeded
  - limiter ≤ 6 in flight
  - D1 down
  - invalid bus route
- **Secrets:** a refresh with a dummy key; the key appears in no body, header, log or error.
- **CI on every push and PR:** typecheck, lint, test, build + size, gitleaks.
- **Deploy** manually from a green `main`: `bun run deploy`, then `bun run smoke <url>`. CI never deploys
  and holds no Cloudflare credentials.
- **Live smoke test** every 6 h in CI, and by hand after each deploy: schema check of `/api/health` and
  `/api/status`.

## 8. Secrets and history

- Key in `.dev.vars` (gitignored) and `wrangler secret` only.
- Small commits, never squashed or rewritten.
- `PROMPTS.md` is updated as work happens.

## 9. Phases (one branch and PR each, CI green)

| # | Phase | Done when |
|---|---|---|
| 0 | Foundations | CI green, manual deploy working, `/api/health` live, prompt log started |
| 1 | API investigation | Fixtures and notes. Spikes: horizon per mode, severity list, timetable CPU (Northern, District), overnight status, ghost trains, key in a header |
| 2 | Rules engine | Test-first, every §7 rule case, config only |
| 3 | Reference data | Lines, stations, gaps, hours in D1; cron; fallbacks logged |
| 4 | Live data layer | §4.1 complete; outage and repeat tests in `docs/verification.md` |
| 5 | Rail UI | All states, service worker, 320 px, dark mode, offline, bundle size |
| 6 | Bus search | Endpoint and UI |
| 7 | Hardening | Security headers, Lighthouse, load test, 3 spot-checks vs tfl.gov.uk |
| 8 | Docs | README, PROMPTS, time, unfinished |

Cut from the end if short of time; bus search goes first.

## 10. Deliverables

[`PLAN.md`](PLAN.md) (sent first) · live `*.workers.dev` URL · repo with real history · `CLAUDE.md` ·
`PROMPTS.md` · README: what it does, rules, architecture, local run, verification, time spent, known
limits, overrides, unfinished.
