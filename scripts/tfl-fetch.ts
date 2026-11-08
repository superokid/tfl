/**
 * Fetch one TfL endpoint for investigation: prints status, size, time and JSON parse time, and
 * optionally saves the (key-redacted) body.
 * Usage: bun scripts/tfl-fetch.ts '/Line/victoria/Arrivals/940GZZLUOXC' [out.json]
 */
import { writeFileSync } from 'node:fs';
import { redact, tflUrl } from '../src/shared/tfl-url.ts';
import { readTflKey } from './tfl-env.ts';

const [path, out] = process.argv.slice(2);
if (!path) {
  console.error("Usage: bun scripts/tfl-fetch.ts '<path?query>' [out.json]");
  process.exit(2);
}

const [p, query = ''] = path.split('?');
const params = Object.fromEntries(new URLSearchParams(query));
const url = tflUrl(p!, readTflKey(), params);

const t0 = performance.now();
const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
const text = await res.text();
const t1 = performance.now();
let parseMs = NaN;
try {
  const t2 = performance.now();
  JSON.parse(text);
  parseMs = performance.now() - t2;
} catch {
  // not JSON
}
console.log(
  `${res.status} ${redact(path)} · ${(text.length / 1024).toFixed(1)} KB · fetch ${(t1 - t0).toFixed(0)} ms · parse ${parseMs.toFixed(2)} ms`,
);
if (out) writeFileSync(out, redact(text));
