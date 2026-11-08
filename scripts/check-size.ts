/**
 * Bundle budget (SPEC §3): JS+CSS < 90 KB gzipped in total; app code (excluding the React
 * vendor chunk) < 20 KB. Run after `bun run build`. Exits 1 if over budget.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const TOTAL_BUDGET = 90 * 1024;
const APP_BUDGET = 20 * 1024;
const dir = 'dist/client/assets';

let files: string[];
try {
  files = readdirSync(dir).filter((f) => /\.(js|css)$/.test(f));
} catch {
  console.error(`No ${dir}; run \`npm run build\` first.`);
  process.exit(2);
}

let total = 0;
let app = 0;
const rows: string[] = [];
for (const file of files.sort()) {
  const gz = gzipSync(readFileSync(join(dir, file)), { level: 9 }).length;
  const vendor = file.startsWith('vendor');
  total += gz;
  if (!vendor) app += gz;
  rows.push(`  ${(gz / 1024).toFixed(1).padStart(6)} KB  ${file}${vendor ? '  (vendor)' : ''}`);
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
console.log(`Bundle (gzipped):\n${rows.join('\n')}`);
console.log(`Total ${kb(total)} / ${kb(TOTAL_BUDGET)} · App ${kb(app)} / ${kb(APP_BUDGET)}`);

if (total > TOTAL_BUDGET || app > APP_BUDGET) {
  console.error('Over budget.');
  process.exit(1);
}
