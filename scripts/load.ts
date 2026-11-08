/**
 * Load test: hammers /api/status (and a few stations) and reports latency, errors and, most importantly,
 * how many distinct TfL refreshes happened: the free-tier footprint under concurrency (ADR-009).
 *   bun scripts/load.ts http://localhost:5180 [seconds=60] [concurrency=20]
 */
const [base, secondsArg = '60', concArg = '20'] = process.argv.slice(2);
if (!base) {
  console.error('Usage: bun scripts/load.ts <base-url> [seconds] [concurrency]');
  process.exit(2);
}
const seconds = Number(secondsArg);
const concurrency = Number(concArg);
const STATIONS = ['HUBSRA', '940GZZLUOXC', 'HUBBAN'];

const latencies: number[] = [];
const codes = new Map<string, number>();
const statusCheckedAt = new Set<number>();
const stationCheckedAt = new Set<string>();
const stale = { status: 0, station: 0 };
const end = Date.now() + seconds * 1000;

async function worker(n: number) {
  let i = 0;
  while (Date.now() < end) {
    // 9 in 10 requests are the main page's poll; 1 in 10 opens a station.
    const station = i++ % 10 === n % 10 ? STATIONS[i % STATIONS.length] : null;
    const path = station ? `/api/station/${station}` : '/api/status';
    const t0 = performance.now();
    try {
      const res = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000) });
      const body = (await res.json()) as { checkedAt?: number; stale?: boolean };
      latencies.push(performance.now() - t0);
      codes.set(String(res.status), (codes.get(String(res.status)) ?? 0) + 1);
      if (body.stale) stale[station ? 'station' : 'status']++;
      if (typeof body.checkedAt === 'number') {
        if (station) stationCheckedAt.add(`${station}@${body.checkedAt}`);
        else statusCheckedAt.add(body.checkedAt);
      }
    } catch (err) {
      codes.set(err instanceof Error ? err.name : 'error', (codes.get('error') ?? 0) + 1);
    }
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: concurrency }, (_, n) => worker(n)));
const took = (Date.now() - t0) / 1000;

latencies.sort((a, b) => a - b);
const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))]?.toFixed(0);
const total = latencies.length;
console.log(`${total} requests in ${took.toFixed(0)} s (${(total / took).toFixed(1)}/s), concurrency ${concurrency}`);
console.log(`latency ms: p50 ${pct(50)} · p95 ${pct(95)} · p99 ${pct(99)} · max ${latencies.at(-1)?.toFixed(0)}`);
console.log(`responses: ${[...codes].map(([c, n]) => `${c}×${n}`).join(' ')} · stale: status ${stale.status}, station ${stale.station}`);
console.log(`line refreshes (distinct checkedAt): ${statusCheckedAt.size} → ≤ ${Math.ceil(took / 30) + 1} expected (1 per 30 s)`);
console.log(`station fetches (distinct station@checkedAt): ${stationCheckedAt.size} for ${STATIONS.length} stations`);

export {};
