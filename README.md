# Status vs Reality

Shows when Transport for London's official line status doesn't match what's really running.

> Work in progress: phases 0–5 done (see [`docs/SPEC.md`](docs/SPEC.md) §9). Bus search, hardening and the
> final README are next.

## How it decides

For every rail line it compares TfL's official status with live arrival predictions at two check
stations. A line is flagged only when **both** stations agree, against that line's own timetable:

- **Worse than reported:** TfL says Good Service (or Minor Delays), but gaps between trains are more than
  `max(2 × usual, usual + 5 min)`.
- **Status looks out of date:** TfL says Suspended (or Severe Delays), but confirmed services run normally
  through both stations in every direction.
- **Matches / Mixed signals / Can't verify / Closed:** the honest answer when the evidence agrees, is split,
  is missing, or the line is closed. It never guesses "OK".

Full rules: [`docs/SPEC.md`](docs/SPEC.md) §5 · decisions: [`docs/adr/`](docs/adr/) · what was checked
live: [`docs/verification.md`](docs/verification.md).

## Run locally

Requires [Bun](https://bun.sh) 1.3+ and Node 22.12+ (Vite runs on Node).

```bash
bun install
cp .dev.vars.example .dev.vars   # then add your TfL key; .dev.vars is gitignored
bun run dev                      # applies local D1 migrations, then starts Vite
```

The first load takes a few seconds (one live refresh); later loads come from the local D1 snapshot.

## Checks

```bash
bun run typecheck && bun run lint && bun run test && bun run build && bun run size
```

CI runs these on every push, plus a gitleaks secret scan.

## Data scripts

- `bun run reference`: regenerate the timetable-derived reference data ([ADR-007](docs/adr/007-generated-reference-data.md)).
- `bun run fixtures`: re-capture trimmed live TfL responses for tests.

## Deploy

Deploys are manual: CI never deploys and holds no Cloudflare credentials.

```bash
bunx wrangler login                      # once
bunx wrangler secret put TFL_APP_KEY     # once; prompts for the key
bun run deploy                           # from a green main; creates the D1 database on first deploy
bunx wrangler d1 migrations apply DB --remote
bun run smoke https://<worker>.workers.dev
```
