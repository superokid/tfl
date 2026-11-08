# Status vs Reality

Shows when Transport for London's official line status doesn't match what's really running.

> Work in progress. Phase 0 (foundations) is done; see [`docs/SPEC.md`](docs/SPEC.md) §9 for the
> phases, and [`docs/PLAN.md`](docs/PLAN.md) for the rules. The full README comes in Phase 8.

## Run locally

Requires [Bun](https://bun.sh) 1.3+ and Node 22.12+ (Vite runs on Node).

```bash
bun install
cp .dev.vars.example .dev.vars   # then add your TfL key; .dev.vars is gitignored
bun run dev
```

Open the printed URL. The page calls `/api/health` and shows whether the Worker is up and the key is
configured. The key itself is never shown.

## Checks

```bash
bun run typecheck && bun run lint && bun run test && bun run build && bun run size
```

CI runs these on every push, plus a gitleaks secret scan.
