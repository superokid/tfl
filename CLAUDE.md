# CLAUDE.md: AI rules for this repo

These rules apply to every AI-assisted change in this repository.

## Read first
- `docs/SPEC.md` is the source of truth for behaviour. `docs/adr/` explains why.
- `docs/tfl-api-notes.md` records how the TfL API actually behaves. Trust it over memory.
- If a task conflicts with the spec or an ADR, stop and say so. Don't silently diverge.

## Never
- Never commit, log, print or echo secrets. `TFL_APP_KEY` lives only in `.dev.vars` (local, gitignored)
  and in `wrangler secret` (production). Never ask the user to paste a key into chat.
- Never send the TfL key to the browser, or put it in fixtures, test output or error messages.
- Never deploy, push, merge or rewrite git history without the user's explicit go-ahead.
- Never squash or amend published commits.
- Never add polling for live status or arrivals (ADR-001). Only reference data is refreshed in the background.
- Never hardcode what the TfL API can provide (ADR-005). Put exceptions in `overrides.ts`, with a reason.
- Never add a UI component library or a heavy dependency without asking. The bundle budget is < 50 KB gzipped.
- Never use the TfL roundel or logo, or imply TfL endorsement.

## Always
- Verify against the live API before relying on an endpoint, field or response shape. Record the findings
  in `docs/tfl-api-notes.md`.
- Keep the rules engine pure: no I/O and no `Date.now()`; pass `now` in. Evaluate times in `Europe/London`.
- Write the test first for rules and data-layer behaviour. Every failure path in the spec has a test.
- Keep thresholds and tunable numbers in the single config file, never inline.
- Prefer showing `CANT_VERIFY` over guessing. A false "OK" is the worst outcome.
- Keep within free-tier limits: ≤ 48 TfL calls per invocation, small payloads, minimal D1 writes.
- Make small, focused commits with clear messages, one logical change each. Check the diff for secrets
  before every commit.
- Say plainly what is unverified or unfinished. Don't claim something works without having checked it.

## Conventions
- TypeScript `strict`. No `any` without a comment explaining why.
- Validate TfL responses at the boundary; treat everything from the network as untrusted.
- Timeouts on every outbound fetch (5 s, `AbortSignal`).
- Mobile-first CSS, semantic HTML, colour never the only signal.
- Commit messages: imperative mood, e.g. `Add stale snapshot fallback to /api/status`.

## Commands
To be filled in during Phase 0, once the project is set up:
- `npm run dev`: local dev (Worker and frontend)
- `npm test`: Vitest
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## Working style
- Work phase by phase, following `docs/SPEC.md` §9. One branch and PR per phase.
- At the end of each phase, report what was done, how it was verified, and what is left.
- When a decision changes the architecture, add or update an ADR in `docs/adr/`.
