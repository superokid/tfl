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

## 2026-11-08: lines near me
- "add a button use my current location to filte" (cut off) → asked; answer: filter rail lines near me.
- Checked live: route sequences give every stop's lat/lon, so the phone filters on its own; the position
  is never sent (ADR-013).
- The feature (~690 B gzipped) took the bundle 70 B over the 80 KB total budget; asked before raising it.

## 2026-11-08: production-readiness audit
- "audit make sure it production ready to deploy for user". Ran every check, read the Worker, and probed
  the live site with GETs only.
- Found: size check over budget (80.3 / 80 KB), so CI would fail; the user said raising it is fine, so it's
  now 90 KB. gitleaks flagged the tests' dummy key once, and 4 more test files use it; it's allowlisted now.
  A missing `/assets/*.js` comes back as index.html with a 200 (checked live), which the service worker
  cached for good. A handler throwing would get Cloudflare's HTML error page. The load test still hit the
  removed `/api/status`. Fixed all of these.
- Docs: the spec still described the dropped D1 budget counter and smoke-tested `/api/status`.

## 2026-11-08: security review
- "do security review on the project". No leaks of the key, no injection, no XSS found.
- Main risk: the on-demand limit (60 TfL calls/min) is per Worker instance, and search, bus stop ids and
  nearby cells are unbounded, so one client could miss the cache every time and exhaust the key's 500/min.
- "Yes, fix it" → Workers Rate Limiting binding, 60 requests/min per IP per location, on on-demand endpoints;
  429 when over, fails open (ADR-014). Checked the binding docs: per location, eventually consistent, not global.

## 2026-11-08: slow line screen
- "line/xxx api still slow. and why when I click detail it hit 2 api lines and api/line/xxx".
  Timed it: cached 0.4 s; a cache miss waits for the slowest of 3 TfL calls, 0.7–4.5 s. The line screen
  never requests `/api/lines`; likely Home's request still in flight, or StrictMode's double fetch in dev.
- "Yes, do it" → `/api/line/:id` now uses the ADR-006 windows: 30–90 s old served at once and refreshed
  in `waitUntil`; older still checked inline.

## 2026-11-08: error handling and resilience
- "make sure any kind of error handle correctly, and make sure the site is survive in a lot of condition just
  show the data". Read every failure path in the Worker and client.
- Worker: a failed D1 write threw away fresh data; a failed failure-mark threw; a corrupt row threw; a
  station fetch that threw was unhandled; an unreadable bus status hid the whole route; TfL error bodies
  were left unread. All degrade now, with tests.
- Client: no error boundary, so one render error blanked the app; validators checked only top-level fields,
  so a bad body or old device copy could crash a screen; the search index and bus stop search weren't
  validated, and a failed stop search said "Searching…" forever. Station and bus pages now keep a device copy.
- Checked in headless Chromium over CDP (the browser tools were down): API blocked, corrupt device copy,
  forced render crash and recovery.

## 2026-11-08: loading UI and skeletons
- "make the UI for loading better, and better skeleton". Replaced the grey blocks with skeletons built from
  each page's real layout classes (line rows, status and check cards, station boards, bus rows, route timeline,
  nearby stops), a page-wide shimmer, a 120 ms fade-in so fast loads don't flash, and a bone for the page title.
  One `role="status"` label per skeleton for screen readers. Checked by screenshot with `/api/*` held open.


## 2026-11-08: mobile spacing, one theme
- "the UI looks so crowded on mobile. I think need separation between bookmark, filter, content, detail".
- Brand and search now sit in their own band; home is labelled blocks (Saved, mode tabs with a divider,
  the mode's content) with more space between blocks than inside them; detail pages put a rule under the
  title. Nearest stations became a wrapping list (the inline one overflowed at 320 px).
- Mid-task: "dont use light theme and dark theme. any theme on browser use the same color" → dark mode
  removed, one light theme (SPEC §6 updated).
- Bundle still over 80 KB (82,210 B, 290 B over), inherited from the lines-near-me branch; left for the user.

## 2026-11-08: free-tier usage
- "make sure the usage for cloudflare free tier is very efficient in this app, so it not eat my quota too fast".
- Audit: the server side was already lean (lease-capped refreshes, 2 D1 writes each, edge caches). Checked live
  that the Cache API works on `workers.dev` (repeat station/line calls reused `checkedAt`).
- Waste found in the client: a tab switch, going back to a screen or coming back online each cost a Worker
  request, even seconds after the last one. Now nothing is refetched within 30 s unless Refresh is tapped.
  Checked in headless Chromium: home → line → home → tab return → line made 0 extra requests; Refresh made 1.
- Per-request invocation logs turned off (account-wide Workers Logs allowance); errors are still logged. Query
  strings redacted, since `/api/nearby` URLs carried the user's rounded position into the logs.

## 2026-11-08: old device copy while loading
- "when data is 1hour ago, and the detail is still loading, improve this ux. if the last data is too long,
  should show the loading skeleton instead of showing very old data".
- A saved copy over 5 min old (`CLIENT.maxDeviceCopyWhileLoadingMs`) is no longer shown while the first fetch
  loads; the skeleton is. If that fetch fails, the old copy still appears with "Last updated …".
