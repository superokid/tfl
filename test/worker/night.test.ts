import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RAIL_REFERENCE } from '../../src/shared/reference/load';
import type { DirectionFile, LineFile } from '../../src/shared/reference/types';
import { londonClock } from '../../src/shared/rules/london';
import { buildLineReport, buildLinesSnapshot } from '../../src/worker/refresh';
import type { TflClient } from '../../src/worker/tfl/client';

/** Live, ~01:12 on a Monday: every line "Service Closed", W&C says "resume at 06:00". */
const night = JSON.parse(readFileSync('test/fixtures/status-rail-night.json', 'utf8'));
const NIGHT = Date.parse(night.capturedAt);

const tfl = (): TflClient => ({
  calls: 0,
  getJson: async (path: string) => (path.endsWith('/Status') ? night.body : []),
});

describe('closed for the night', () => {
  it('home screen: off hours, opening from TfL when it says, else the timetable', async () => {
    const s = await buildLinesSnapshot(tfl(), RAIL_REFERENCE, NIGHT);
    const byId = new Map(s.lines.map((l) => [l.lineId, l]));

    expect(byId.get('waterloo-city')).toMatchObject({ severity: 'CLOSED', offHours: true, opensAt: Date.UTC(2026, 10, 9, 6, 0) });

    const victoria = byId.get('victoria')!;
    expect(victoria.offHours).toBe(true);
    const { weekday, minutes } = londonClock(victoria.opensAt!);
    expect(weekday).toBe(1);
    expect(minutes).toBeGreaterThan(5 * 60);
    expect(minutes).toBeLessThan(6 * 60 + 30);

    // The Elizabeth line's timetable comes from the journey planner (ADR-018): its first train, this morning.
    const elizabeth = byId.get('elizabeth')!;
    expect(elizabeth.offHours).toBe(true);
    expect(londonClock(elizabeth.opensAt!).minutes).toBeLessThan(7 * 60);
    expect(byId.get('london-cable-car')).toMatchObject({ offHours: false, opensAt: null });
  });

  it('no timetable, and TfL only says "later this morning": closed for the night, time unknown', async () => {
    const reference = {
      ...RAIL_REFERENCE,
      lines: RAIL_REFERENCE.lines.map((l) => (l.lineId === 'elizabeth' ? { ...l, stations: l.stations.map((st) => ({ ...st, directions: [] })) } : l)),
    };
    const s = await buildLinesSnapshot(tfl(), reference, NIGHT);
    expect(s.lines.find((l) => l.lineId === 'elizabeth')).toMatchObject({ offHours: true, opensAt: null });
  });

  it('a timetable time that contradicts "later this morning" is dropped, not shown', async () => {
    // A faulty reference: Victoria runs only on Fridays, so its next first train is days away.
    const victoria = RAIL_REFERENCE.lines.find((l) => l.lineId === 'victoria')!;
    const fridaysOnly: LineFile = {
      ...victoria,
      stations: victoria.stations.map((st) => ({
        ...st,
        directions: st.directions.map((d) => ({ ...d, weekdays: [-1, -1, -1, -1, -1, 0, -1] as DirectionFile['weekdays'] })),
      })),
    };
    const s = await buildLinesSnapshot(tfl(), { ...RAIL_REFERENCE, lines: [fridaysOnly] }, NIGHT);
    expect(s.lines[0]).toMatchObject({ offHours: true, opensAt: null });
  });

  it('line screen: outside hours (not a planned closure), with each station\'s first train', async () => {
    const r = (await buildLineReport(tfl(), RAIL_REFERENCE, 'victoria', NIGHT))!;
    expect(r).toMatchObject({ verdict: 'CLOSED', reason: 'outside-hours', offHours: true });
    expect(r.boards).toHaveLength(2);
    for (const b of r.boards) expect(b.firstTrainAt).toBeGreaterThan(NIGHT);
    expect(r.opensAt).toBe(Math.min(...r.boards.map((b) => b.firstTrainAt!)));
  });
});
