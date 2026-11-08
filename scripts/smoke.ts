/**
 * Live smoke test: checks the deployed API's response schemas.
 * Usage: bun scripts/smoke.ts https://<worker>.workers.dev
 * Runs after every deploy and every 6 h in CI (SPEC §7).
 */
import { isHealthBody, isStatusBody } from '../src/shared/api.ts';

const base = process.argv[2] ?? process.env.LIVE_URL;
if (!base) {
  console.error('Usage: bun scripts/smoke.ts <base-url>  (or set LIVE_URL)');
  process.exit(2);
}

async function check(path: string, validate: (body: unknown) => boolean): Promise<boolean> {
  const url = new URL(path, base);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const body: unknown = await res.json();
    const ok = res.ok && validate(body);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${url.pathname} → ${res.status}`);
    if (!ok) console.log(JSON.stringify(body).slice(0, 500));
    return ok;
  } catch (err) {
    console.log(`FAIL ${url.pathname} → ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

const results = [await check('/api/health', isHealthBody), await check('/api/status', isStatusBody)];

process.exit(results.every(Boolean) ? 0 : 1);
