/**
 * Builds src/shared/reference/rail.json from the live TfL API (ADR-007).
 *   bun run reference
 * Re-run when TfL changes timetables or lines. ~150 calls, 6 at a time, well under 500/min.
 */
import { writeFileSync } from 'node:fs';
import type { Mode } from '../src/shared/config.ts';
import { createLimiter } from '../src/shared/limit.ts';
import { directionFromTimetable, learnBoundDirections, pickCheckStations } from '../src/shared/reference/derive.ts';
import { OVERRIDES } from '../src/shared/reference/overrides.ts';
import type { DirectionFile, LineFile, ReferenceFile } from '../src/shared/reference/types.ts';
import { redact, tflUrl } from '../src/shared/tfl-url.ts';
import { readTflKey } from './tfl-env.ts';

const RAIL_MODES = 'tube,elizabeth-line,dlr,overground,tram,cable-car';
const OUT = 'src/shared/reference/rail.json';
const key = readTflKey();
const limit = createLimiter(6);
let calls = 0;

async function get(path: string, params: Record<string, string> = {}): Promise<unknown | null> {
  return limit(async () => {
    calls++;
    try {
      const res = await fetch(tflUrl(path, key, params), { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn(`  ! ${path}: ${redact(String(err))}`);
      return null;
    }
  });
}

type Json = Record<string, unknown>;
const lines = ((await get(`/Line/Mode/${RAIL_MODES}`)) ?? []) as Json[];
if (lines.length === 0) throw new Error('no lines from TfL');

const built: LineFile[] = await Promise.all(
  lines.map(async (l): Promise<LineFile> => {
    const lineId = String(l.id);
    const base = { lineId, lineName: String(l.name), mode: String(l.modeName) as Mode, notes: [] as string[] };

    const override = OVERRIDES[lineId];
    if (override?.statusOnly) {
      base.notes.push(`override: ${override.reason}`);
      return { ...base, statusOnly: true, stations: [], boundDirections: {} };
    }
    const sequence = await get(`/Line/${lineId}/Route/Sequence/outbound`);
    let picks = pickCheckStations(sequence);
    if (override?.checkStations) {
      const names = new Map(picks.map((p) => [p.stopId, p.name]));
      picks = override.checkStations.map((id) => ({ stopId: id, name: names.get(id) ?? id }));
      base.notes.push(`override: ${override.reason}`);
    }

    const samples = await Promise.all(picks.map((p) => get(`/Line/${lineId}/Arrivals/${p.stopId}`)));
    const hasPredictions = samples.some((s) => Array.isArray(s) && s.length > 0);
    const everyCallFailed = samples.every((s) => s === null);
    if (picks.length < 2 || everyCallFailed) {
      base.notes.push(picks.length < 2 ? 'fewer than 2 check stations' : 'arrivals endpoint unavailable');
      return { ...base, statusOnly: true, stations: [], boundDirections: {} };
    }
    if (!hasPredictions) base.notes.push('no predictions in the sample (may be closed right now)');

    const stations = await Promise.all(
      picks.map(async (p) => {
        const directions = (
          await Promise.all(
            (['inbound', 'outbound'] as const).map(async (dir) => {
              const d = directionFromTimetable(await get(`/Line/${lineId}/Timetable/${p.stopId}`, { direction: dir }), dir);
              if (!d) base.notes.push(`no ${dir} timetable at ${p.name}`);
              return d;
            }),
          )
        ).filter((d): d is DirectionFile => d !== null);
        return { stopId: p.stopId, name: p.name, directions };
      }),
    );

    const boundDirections = Object.assign({}, ...samples.map((s) => learnBoundDirections(s)));
    return { ...base, statusOnly: false, stations, boundDirections };
  }),
);

built.sort((a, b) => a.lineId.localeCompare(b.lineId));
const file: ReferenceFile = { generatedAt: new Date().toISOString(), lines: built };
const json = JSON.stringify(file);
if (/app_key=/.test(json)) throw new Error('key leaked into reference');
writeFileSync(OUT, `${json}\n`);

console.log(`Wrote ${OUT} (${(json.length / 1024).toFixed(1)} KB) from ${calls} calls`);
for (const l of built) {
  const st = l.statusOnly ? 'status-only' : l.stations.map((s) => `${s.name} [${s.directions.map((d) => d.directionKey[0]).join('')}]`).join(', ');
  console.log(`  ${l.lineId.padEnd(18)} ${st}${l.notes.length ? `  · ${l.notes.join('; ')}` : ''}`);
}
