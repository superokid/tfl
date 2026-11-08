# Prompts

Sample of prompts used (Claude Code), with corrections.

## 2026-11-08: plan review
- "review the plan, any bad or need improve" + the brief.
  - Checked against the live API. Found:
    - the Cable Car has no predictions (false alarms)
    - D1 counts toward the 50-subrequest limit
    - prediction horizon is shorter than the window
    - React exceeds a 50 KB budget
  - Spec was fixed.
- "there are too many unnecessary written, just keep your writing minimal": docs cut by about half.

## 2026-11-08: Phase 0, foundations
- "I have updated the docs, now execute the plan, make the first step that I can check the changes to test"
  - Scope kept to Phase 0: scaffold, `/api/health`, tests, CI. No deploy or push without a go-ahead.
  - Correction during the build: the client was importing a type from the Worker; moved the API
    contracts to `src/shared/api.ts` so browser code never depends on Worker types.
- "remove the docs/time-log.md, its just noise": deleted; time spent goes in the README, taken from git history.
- "use bun instead of npm": npm install was stalling (10+ min), so I switched to Bun (installed in ~5 min).
  CI now uses `oven-sh/setup-bun`, and `bun.lock` is committed.
- Found while building: TypeScript 7 isn't supported by typescript-eslint yet, so TypeScript is pinned to 6.
  `secrets.required` in `wrangler.jsonc` keeps generated types the same with or without `.dev.vars`.
- "Just make the deployment from cloudflare manually. not from CI": removed the CI deploy job, so CI holds no
  Cloudflare credentials. Deploy is `bun run deploy` from a green `main`, followed by a manual smoke test.
- The first CI run caught a gitleaks false positive on the test's fake key. Fixed by making the value
  low-entropy instead of disabling the rule.

## 2026-11-08: Phase 2, rules engine
- "continue phase2": Phase 1 (fixtures) wasn't done, so the engine takes a typed domain model instead of raw
  TfL JSON. Parsing gets tested against real fixtures later, and the rules don't depend on TfL field names.
- Tests written first (87). One failure was my own test data; fixing it exposed a real case worth a rule:
  a train in 1 min and then nothing until 40 min must count as a long wait, even past the 30 min window.
- "you allowed to merge each step", then "push still not allowed, only merge": merge locally, ask before push.

## 2026-11-08: Phase 1, API investigation
- "continue all the next phase, until I can test it on UI"
  - Live check during a real Bakerloo part-suspension found ghost vehicles inside the suspended section and
    normal-looking service at the boundary stop. Either would have raised a false "TfL says Suspended, but
    trains are running". Rule tightened: "running normally" now needs confirmed through-services in every
    direction.
  - `/Line/Meta/Severity` had 3 rail descriptions the spec table missed; a fixture test now fails on any
    unmapped one.

## 2026-11-08: Phase 3, reference data
- Measured before building: ~84 timetables of 300–500 KB don't fit a 10 ms / 50-subrequest cron. Changed
  ADR-005 to ADR-007: the script generates a committed JSON file from the same API.
- First generated output was checked by eye and corrected: District picked a shuttle-branch station
  (now weighted by route length); Cable Car had no predictions (override with reason). TfL has no
  timetables for the Elizabeth line or Overground; recorded as a known limit, not worked around.

## 2026-11-08: Phase 4, live data layer
- Tests for every failure path in SPEC §4.1 run against a fake TfL behind the real client. One failing test
  showed that after a failure every request retried TfL; added a 10 s back-off.
- First local run against live TfL: cold refresh 6.2 s, then 25 ms from D1. Read every verdict by hand:
  DLR predictions only reach 2–13 min ahead (known limit), and Liberty's "can't verify" sentence overstated
  the evidence, so it was reworded.

## 2026-11-08: Phase 5, rail UI
- First screenshot: every line was hidden behind three closed groups → changed to one compact, tappable row
  per line, with mismatches as full cards on top.
- Reading the live page found Lioness "Part Closure" marked "Matches" while trains ran inside the closure.
  MATCH now needs every station to agree; a split shows as "Mixed signals".
- A live Tram hidden disruption appeared during testing (marginal: 9.01 min vs a 9 min threshold);
  logged in docs/verification.md as tuning input, not tuned after one observation.

## 2026-11-08: live arrivals and TfL messages
- "The UI should not only show what good and not match only. it should show real data, when it arrive. it will
  be replace the current tfl website"
  - The arrivals and TfL's messages were already fetched every refresh and then thrown away, so they're now
    kept: next 6 trains per direction counting down, TfL's message per line, an alphabetical list of all lines,
    and `/#<line>` deep links.
  - The first live screenshot contradicted itself: "8-minute gap" next to a board showing trains every 2 min.
    The gap was real but later than the 4 trains shown. The sentence now says when the gap starts, and boards
    show 6 trains.
  - Stored snapshots are versioned so an older shape left in D1 after a deploy is refreshed, not served.

## 2026-11-08: station search and the free-tier footprint
- "Yes, add search": search any rail station for live departures. The index comes from the same script as
  the reference data, so typing never calls TfL.
- Mid-build: "make sure this app not hit my monthly limit fast, since I have other website rely on this free
  cloudflare". Checked the limits: daily and account-wide. Cut D1 writes per refresh from ~5 to 2, dropped the
  D1 budget table, refresh ≤ every 30 s, client polls every 60 s and stops when idle. A test drives 600
  requests and checks the bound.
- Live Stratford page: TfL's own `direction` put eastbound Gidea Park trains with Paddington ones → boards
  group by physical platform. The Jubilee terminus listed only "Stratford" → terminating trains are marked
  and merged.

## 2026-11-08: Phase 7, hardening
- "continue next phase": headers, Lighthouse, load test, spot-checks, all on the production build.
- The load test found a station-cache stampede (38 TfL fetches instead of ~9, 5 errors). Fixed by sharing one
  in-flight fetch per station; re-run: 0 errors, 9 fetches.

## 2026-11-08: Phase 8, docs
- Final README written against the brief: live URL, AI rules file, prompts, how it was verified, time spent
  (from git history), what isn't finished.
- Caught while writing the deploy steps: an auto-provisioned D1 would be created near the deployer (UTC+8),
  far from London users, so the README now creates it in `weur` first.

## 2026-11-08: passenger-first redesign
- "make the design user friendly. currently it confusing for user who use bus, train, etc. improve overall UX
  and fit what the user really need."
- Mid-build: "I think dont fetch everything at once. just fetch on user request with better UI". Each screen now
  fetches only its own data: home statuses (1–2 calls instead of ~42; 2 s cold instead of 6 s), a line's check
  when opened, "Check every line" only on tap (ADR-011).
- Buses added on demand: route status (the all-routes call measured ~800 KB / 18 s, so per route), stop search
  keeping TfL's "towards" so same-named stops can be told apart, live stop departures.
- Phone screenshots found: page overflow from the scrolling tab bar (grid min-width), the Bus tab hidden
  off-screen (tabs now wrap), bus destinations truncated, a duplicated station heading. All fixed and re-shot.
- "why the bus only show good service. not showing the time of next bus": the route page only fetched status;
  times needed a stop search first. Route page now lists every stop in order with its next buses.
- "make sure not spamming my cloudflare api limit & have good budget": status and times in one response
  (1 Worker request per minute while the page is open), stop order cached a day (2 TfL calls per refresh),
  30 s edge cache shared by everyone, no D1 writes. Tests assert 4 calls cold, 0 within 30 s, 2 after.
- "api/line/xx is very slow. just cache on browser far longer while it loading a new data": line pages now
  keep their last result on the phone and show it at once, marked "Last updated …", while the live check
  loads. The "can't reach the service" banner now waits for a real error.

## 2026-11-08: bus stops near you
- "Instead of check bus number, is it better just put the station location, and show how many minutes for the
  next bus" → "yes fix it. and cloudflare budged friendly". Bus tab is now stop-first: "Use my location"
  lists the 5 closest stops with next buses (ADR-012).
- Checked live first: nearby stops is one call, but TfL won't take several stops in one arrivals call (404),
  so times reuse the per-stop 30 s cache. Location rounded to ~100 m on the phone; stop list cached a day per
  cell; one Worker request per minute; no D1 writes.
- Screenshots found the "›" wrapping onto its own line and two "updated" rows on the Bus tab (it was also
  polling rail status it didn't show). Both fixed; the search box moved above the nearby list.


## 2026-11-08: slow APIs
- "review & fix some api are very slow". Timed every endpoint cold on `bun run dev`. TfL is noisy, 0.4–3.7 s
  per call; `/StopPoint` and `/Line` arrivals are no different, and `?detail=true` is 3–4 s.
- Cause: line and check-all waited for the status call before sending arrivals. They now go out together;
  2 calls are reserved for status and detail. Home also reads both D1 snapshots at once.
- Cold `/api/line/:id` went from 0.8–2.6 s to 0.4–0.9 s; `/api/checks` went from 4.1 s to 2.6 s.
- "Deploy and check": the edge cache does work on `*.workers.dev` (max-age counts down, hits ≈ 0.25 s). From
  Indonesia, requests alternate SIN/NRT colos, each with its own cache, and every cold call crosses to London.
- Correction: deploying from a clean worktree (no `.wrangler` state) auto-created D1 in APAC with no tables,
  not `weur`. Deleted it, recreated in `weur`, pinned `database_id` in `wrangler.jsonc`, migrated, redeployed.

## 2026-11-08: UI/UX review
- "review the UI UX, make sure it very user friendly and usefull". Reviewed every screen at 390 and 320 px,
  light and dark, on live data.
- Found: boards of 6 trains per platform (Oxford Circus was 3 screens long), bus stop page with no letter or
  direction, home hiding why a line is delayed, two search boxes stacked on the Bus tab, a TfL reason
  starting lowercase, bus times wrapping at 320 px.
- Fixed: 3 per platform with "More times"; stop letter and direction from the arrivals already fetched (no
  extra call); TfL's reason under problem lines; one search box; page titles per screen.
- Another session was editing the same folder, so this work moved to its own worktree.

## 2026-11-08: lines near me
- "add a button use my current location to filte" (cut off) → asked; answer: filter rail lines near me.
- Checked live: route sequences give every stop's lat/lon, so the phone filters on its own; the position
  is never sent (ADR-013).
- The feature (~690 B gzipped) took the bundle 70 B over the 80 KB total budget; asked before raising it.

