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
