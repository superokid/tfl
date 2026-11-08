# Spec: TfL Status vs Reality

> Source of truth for what we build. Decisions and their reasoning live in [`docs/adr/`](adr/).
> If the code and this spec disagree, fix one of them in the same PR.

## 1. Goal

A live web tool, used by real London passengers, that shows when Transport for London's official
line status doesn't match what's really running.

It answers one question in under a second on a phone:
**"Is TfL's official status telling the truth right now?"**

### Quality bar
- Correct on live data.
- Survives TfL outages and repeated or concurrent requests.
- Tests on every push.
- No keys in the repo, in logs, or in the browser.
- Fast and clean on a phone.
- Real, incremental git history.

## 2. Scope

| In scope | How |
|---|---|
| Every TfL rail line: Tube, Elizabeth line, DLR, Overground, Tram, Cable Car | Checked automatically on every refresh |
| Every bus route | Status shown; a route is checked when a user searches for it ([ADR-003](adr/003-rail-automatic-bus-on-demand.md)) |

| Out of scope (for now) | Why |
|---|---|
| History / trends | Needs polling and storage growth; not required to answer "right now" |
| Map view | A list is faster and clearer on a phone ([ADR-004](adr/004-text-list-no-map.md)) |
| Accounts, notifications | Not needed for the core question |

Nothing the API can provide is hardcoded: line lists, check stations and normal frequencies come
from TfL ([ADR-005](adr/005-reference-data-from-api.md)). A small `overrides.ts` is allowed only
where the automatic choice is wrong. Every override is listed in the README with its reason.

## 3. Stack and platform constraints

- TypeScript everywhere. React + Vite frontend. Cloudflare free tier only.
- One Cloudflare Worker serves both the static React app (Workers static assets via
  `@cloudflare/vite-plugin`) and the API.
- One D1 database (location hint `weur`).
- No UI component library. System fonts. Budget: < 50 KB JS+CSS gzipped.

| Limit | Value | Design consequence |
|---|---|---|
| Worker subrequests (free) | 50 per invocation | ≤ 48 TfL calls per refresh |
| Worker CPU (free) | 10 ms per request | Fetch small per-station payloads; no giant JSON parses |
| D1 writes (free) | 100k / day | One snapshot row, overwritten; at most ~6k writes/day |
| TfL API | 500 req / min per key | 15 s freshness plus a global call budget |

Verify every TfL endpoint and response shape against the live API before relying on it. Notes go
in `docs/tfl-api-notes.md`.

## 4. Data

### 4.1 Live data: on request only, never polled ([ADR-001](adr/001-fetch-on-request-not-polling.md))

**`GET /api/status`** (all rail lines)
1. Read the latest snapshot from D1. If it's < 15 s old, return it.
2. Otherwise fetch from TfL in parallel, with a 5 s timeout per call (`AbortSignal`):
   - status for all rail modes (1 call)
   - arrivals at 2 check stations per rail line (≈ 21 lines × 2 = 42 calls)
3. Run the rules engine, save the snapshot and timestamp to D1 (one row, overwritten), and return it.
4. Failure handling:
   - Status call fails → return the stored snapshot with `stale: true` and its age.
   - Some arrivals calls fail → only those lines become `CANT_VERIFY`.
   - Never overwrite a good snapshot with a fully failed fetch.
   - No snapshot at all and TfL down → `503` with a clear JSON error; the UI shows a friendly state.
   - D1 unavailable → fetch TfL directly and serve the result uncached (the budget is skipped, and the
     problem is logged).
5. Response header: `Cache-Control: max-age=15`.

**`GET /api/bus/:routeId`**
- Validate `routeId` against the known bus route list. Reject anything else, so the Worker is never
  an open proxy.
- Same pattern: one D1 row per route, 15 s freshness, stale fallback.
- Calls: route status, plus arrivals at 2 check stops.

**TfL call budget:** a per-minute counter of TfL calls in D1. Above 400/min, don't refetch; serve
the stored data, marked stale. This protects every user when someone hammers the API.

**Known race:** two simultaneous cache misses may both call TfL. That's acceptable at this scale and
is documented in the README.

### 4.2 Storage layers ([ADR-002](adr/002-d1-snapshot-plus-browser-cache.md))

| Layer | Handles |
|---|---|
| D1 (server) | Outages for everyone, including first-time visitors; one shared TfL fetch per 15 s; rate-limit safety |
| HTTP cache (`max-age=15`) | Instant repeat loads |
| `localStorage` | Last good result on the device, for a bad phone signal or offline use |

### 4.3 Reference data: background refresh, never on the user's request

- **Line list:** `/Line/Mode/{modes}`.
- **Check stations per line:** taken from the route sequence. Pick 2 stations served by every branch
  (or the most branches), at least 2 stops from either end, and spread apart.
- **Normal gap per line, per time band** (peak / off-peak / evening / night): derived from TfL's
  timetable.
- Stored in D1 with `fetchedAt`. An hourly Cron Trigger refreshes entries older than 24 h, in batches
  small enough to stay under 50 subrequests.
- If a normal gap is missing or the timetable can't be parsed, fall back to a documented per-mode
  default and record that the fallback was used.
- Bus route reference data is fetched the first time a route is searched, then cached for 24 h.

Live status and arrivals are never polled. Only this slow-changing reference data is refreshed in the
background.

## 5. Mismatch rules

The rules engine is a **pure function**: input = status + arrivals + reference data + `now`;
output = verdicts. It does no I/O and never calls `Date.now()`. Times are evaluated in
`Europe/London`, with daylight saving handled.

### Definitions
- **Gap:** the largest interval between consecutive predicted arrivals at a check station, in one
  direction, inside the window.
- **Window:** 30 min if the normal gap is ≤ 5 min, otherwise 60 min.
- **Threshold:** `max(2 × normal gap, normal gap + 5 min)`.

All numbers live in one config file so they can be tuned. Tuning against live data is recorded in
`docs/verification.md`.

### Verdicts

| Verdict | When |
|---|---|
| `HIDDEN_DISRUPTION` | TfL says *Good Service*, and at ≥ 2 check stations the gap is above the threshold, **or** the arrivals call succeeded but returned nothing. |
| `STALE_ALERT` | TfL says *Suspended*, but ≥ 2 check stations show services within the threshold. For *Part Suspended*, judge only if TfL lists the affected stops and a check station is among them; otherwise `CANT_VERIFY`. |
| `MATCH` | The evidence agrees with the status, including reported delays that the gaps confirm. |
| `CANT_VERIFY` | Data is missing or unclear: failed calls, fewer than 2 usable stations, or no known normal gap. Never guess "OK". |
| `CLOSED` | Outside operating hours, or during a planned closure. Never flagged as a mismatch. |

Every verdict carries its **evidence**: station, direction, normal gap, observed gap and checked-at
time, plus a plain-English sentence, e.g.
*"TfL says Good Service, but the next train at Brixton is 14 minutes away (usually 3)."*

## 6. UI: mobile-first, plain text list, no map

- **Header:** "Status vs Reality", "Live · updated 12s ago" (the age keeps counting), and a refresh
  button.
- **Mismatch cards first,** with a stripe in the line's colour: "TfL says: …" / "Services show: …".
  Tap a card to expand the evidence.
- **Matching lines below,** collapsed and muted. `CANT_VERIFY` and `CLOSED` are grouped last.
- **Bus section:** a route search (type "38") with suggestions; results use the same card. The last
  few searched routes are kept in `localStorage`.

| State | What the user sees |
|---|---|
| All match | Green "All N lines match what's running" |
| Stale | Amber "TfL isn't responding, showing information from 4 min ago" |
| No data at all | Friendly message and a retry button |
| Night | "Most lines are closed, checks resume at 05:30" |
| Loading | Skeleton layout |
| Offline | Last good result from `localStorage`, with its age |

- Auto-refresh every 30 s while the tab is visible; pause when hidden.
- Accessibility: semantic HTML, colour never the only signal, AA contrast, works at 320 px width,
  respects `prefers-color-scheme`.
- No TfL roundel or logo, and no implied TfL endorsement. Credit "Powered by TfL Open Data".

## 7. Tests and CI

- **Fixtures:** real live TfL responses, trimmed, with the key stripped.
- **Rules:**
  - every verdict
  - frequent vs infrequent lines
  - empty predictions at 1 vs 2 stations
  - night and planned closure
  - daylight-saving boundaries
  - Part Suspended with and without affected stops
  - missing normal gap → `CANT_VERIFY`
- **Station selection:** branching lines (e.g. Northern, District) pick shared-section stations.
- **Data layer:**
  - fresh snapshot → no TfL call
  - stale snapshot → refetch
  - TfL down → stale snapshot returned
  - partial failure → only those lines `CANT_VERIFY`
  - budget exceeded → no refetch
  - invalid bus `routeId` → rejected
- **GitHub Actions on every push and PR:** install, typecheck, lint, test, build, plus a gitleaks
  secret scan.

## 8. Secrets and repo hygiene

- `.dev.vars` is gitignored; only `.dev.vars.example` is committed. The production key is set with
  `wrangler secret put TFL_APP_KEY`.
- The key never reaches the browser, never appears in logs, and never ends up in fixtures.
- Small commits with clear messages, one per meaningful step. Never squash or rewrite history.

## 9. Delivery phases

Each phase is its own branch and PR, merged with CI green.

| # | Phase | Done when |
|---|---|---|
| 0 | Foundations | CI green, placeholder deployed to workers.dev and calling `/api/health`, no secrets |
| 1 | API investigation | Fixtures saved; `docs/tfl-api-notes.md` written, including anything that contradicts this spec |
| 2 | Rules engine | Pure, test-first, every verdict and edge case covered, thresholds in config |
| 3 | Reference data | Line discovery, station selection and normal gaps in D1, cron refresh, fallbacks logged |
| 4 | Live data layer | `/api/status` with snapshot, stale fallback, partial failure handling and budget; manual outage and repeat tests in `docs/verification.md` |
| 5 | Rail UI | All states; checked at 320 px, in dark mode and offline; bundle size reported |
| 6 | Bus search | `/api/bus/:routeId` validated and cached; search UI with recent routes |
| 7 | Hardening | Security headers, Lighthouse mobile, load test, 3 live spot-checks against tfl.gov.uk |
| 8 | Docs | README, `PROMPTS.md` with real prompts and corrections, time spent, what isn't finished |

If time runs short, cut from the end. Phase 6 is the first to go, and gets listed as unfinished.

## 10. Deliverables

1. Live URL on `*.workers.dev`.
2. GitHub repo with real incremental history.
3. `CLAUDE.md`: AI rules for this repo.
4. `PROMPTS.md`: a representative sample of the prompts used, including corrections.
5. `README.md`:
   - what it does, for a non-technical reader
   - the rules and why
   - architecture
   - how to run locally
   - how it was verified
   - time spent
   - known limits
   - what isn't finished
