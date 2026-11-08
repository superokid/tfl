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
  The key is the `app_key` query parameter, so a TfL URL is a secret: build it only with the URL helper,
  and log or throw it only after redacting.
- Never deploy, push, merge or rewrite git history without the user's explicit go-ahead.
- Never squash or amend published commits.
- Never add polling for live status or arrivals (ADR-001). Only reference data is refreshed in the background.
- Never hardcode what the TfL API can provide (ADR-005). Put exceptions in `overrides.ts`, with a reason.
- Never add a UI component library or a heavy dependency without asking. The bundle budget is < 80 KB
  gzipped in total, with app code (everything except React) < 20 KB.
- Never let a fallback normal gap, empty predictions or a frozen feed produce a mismatch verdict. Those
  are `CANT_VERIFY`.
- Never use the TfL roundel or logo, or imply TfL endorsement.

## Always
- Verify against the live API before relying on an endpoint, field or response shape. Record the findings
  in `docs/tfl-api-notes.md`.
- Keep the rules engine pure: no I/O and no `Date.now()`; pass `now` in. Evaluate times in `Europe/London`.
- Write the test first for rules and data-layer behaviour. Every failure path in the spec has a test.
- Keep thresholds and tunable numbers in the single config file, never inline.
- Prefer showing `CANT_VERIFY` over guessing. A false "OK" is the worst outcome; a false alarm is next.
- Keep within free-tier limits: ≤ 50 subrequests per invocation **including D1 calls** (≤ 40 TfL,
  ≤ 6 D1), at most 6 fetches in flight, 10 ms CPU, small payloads, minimal D1 writes.
- Log each AI session's key prompts and corrections in `PROMPTS.md` as the work happens.
- Make small, focused commits with clear messages, one logical change each. Check the diff for secrets
  before every commit.
- Say plainly what is unverified or unfinished. Don't claim something works without having checked it.

## Conventions
- TypeScript `strict`. No `any` without a comment explaining why.
- Validate TfL responses at the boundary; treat everything from the network as untrusted.
- Timeouts on every outbound fetch (5 s, `AbortSignal`), started when the call is sent, not when it
  is queued in the concurrency limiter.
- Mobile-first CSS, semantic HTML, colour never the only signal.
- Commit messages: Conventional Commits, imperative mood, e.g. `feat: add stale snapshot fallback to /api/status`.

## Commands
Bun is the package manager: commit `bun.lock`, never `package-lock.json`.
- `bun run dev`: local dev, Worker and frontend together (Vite + Cloudflare plugin)
- `bun run test`: Vitest in `test/` (not `bun test`, which is Bun's own test runner)
- `bun run typecheck`: checks `worker-configuration.d.ts` is current, then `tsc -b` for app, worker and scripts
- `bun run types`: regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc`
- `bun run lint`
- `bun run build`, then `bun run size`: bundle budget check
- `bun run smoke <url>`: schema check against a live deployment
- `bun run deploy`: build and deploy (only with the user's go-ahead)

## Layout
- `src/worker/`: Worker (API). `src/client/`: React app. `src/shared/`: types and pure code used by both.
  Client code never imports from `src/worker/`.
- `test/`: Vitest tests. `scripts/`: TypeScript scripts run with Bun.

## Working style
- Work phase by phase, following `docs/SPEC.md` §9. One branch and PR per phase.
- At the end of each phase, report what was done, how it was verified, and what is left.
- When a decision changes the architecture, add or update an ADR in `docs/adr/`.
