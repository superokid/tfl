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
