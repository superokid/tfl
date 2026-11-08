/** Reads TFL_APP_KEY from the environment or .dev.vars for local scripts. Never prints it. */
import { readFileSync } from 'node:fs';

export function readTflKey(): string {
  if (process.env.TFL_APP_KEY) return process.env.TFL_APP_KEY;
  try {
    for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
      const m = /^\s*TFL_APP_KEY\s*=\s*"?([^"\s]+)"?\s*$/.exec(line);
      if (m?.[1]) return m[1];
    }
  } catch {
    // fall through
  }
  console.error('TFL_APP_KEY not found in the environment or .dev.vars');
  process.exit(2);
}
