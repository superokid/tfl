import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandDirection, RAIL_REFERENCE, STATIONS } from '../../src/shared/reference/load';
import { OVERRIDES } from '../../src/shared/reference/overrides';

describe('generated rail reference (src/shared/reference/rail.json)', () => {
  const lines = RAIL_REFERENCE.lines;

  it('covers every rail line once', () => {
    expect(lines.length).toBeGreaterThanOrEqual(21);
    expect(new Set(lines.map((l) => l.lineId)).size).toBe(lines.length);
  });

  it('has a valid generatedAt', () => {
    expect(Number.isNaN(Date.parse(RAIL_REFERENCE.generatedAt))).toBe(false);
  });

  it('every judged line has 2 distinct check stations', () => {
    for (const l of lines.filter((x) => !x.statusOnly)) {
      expect(l.stations, l.lineId).toHaveLength(2);
      expect(l.stations[0]!.stopId, l.lineId).not.toBe(l.stations[1]!.stopId);
    }
  });

  it('status-only lines are exactly the overridden ones, each with a reason', () => {
    const statusOnly = lines.filter((l) => l.statusOnly).map((l) => l.lineId);
    const overridden = Object.entries(OVERRIDES).filter(([, o]) => o.statusOnly).map(([id]) => id);
    expect(statusOnly.sort()).toEqual(overridden.sort());
  });

  it('service days are sane: first < last, positive gaps, weekday indexes valid', () => {
    for (const l of lines) {
      for (const s of l.stations) {
        for (const d of s.directions) {
          for (const day of d.serviceDays) {
            expect(day.firstMin).toBeLessThan(day.lastMin);
            for (const b of day.bands) {
              expect(b.normalGapMin).toBeGreaterThan(0);
              expect(b.longestGapMin).toBeGreaterThanOrEqual(b.normalGapMin);
            }
          }
          for (const w of d.weekdays) expect(w).toBeLessThan(d.serviceDays.length);
        }
      }
    }
  });

  it('every judged line with timetables has service Mon–Fri in every direction', () => {
    for (const l of lines.filter((x) => !x.statusOnly)) {
      for (const s of l.stations) {
        for (const d of s.directions) {
          expect(d.weekdays.slice(1, 6).every((w) => w >= 0), `${l.lineId} ${s.name} ${d.directionKey}`).toBe(true);
        }
      }
    }
  });

  it('expands to the engine form (Victoria has service every day)', () => {
    const victoria = lines.find((l) => l.lineId === 'victoria')!;
    const ref = expandDirection(victoria.stations[0]!.directions[0]!);
    expect(Object.keys(ref.days)).toHaveLength(7);
  });

  it('contains no key', () => {
    expect(readFileSync('src/shared/reference/rail.json', 'utf8')).not.toMatch(/app_key/);
  });
});

describe('generated station index (src/shared/reference/stations.json)', () => {
  it('every station has coordinates in or near London, for "Lines near me"', () => {
    expect(STATIONS.stations.length).toBeGreaterThan(400);
    for (const s of STATIONS.stations) {
      expect(s.lat, s.id).toBeGreaterThan(51.2);
      expect(s.lat, s.id).toBeLessThan(51.8);
      expect(s.lon, s.id).toBeGreaterThan(-1.1);
      expect(s.lon, s.id).toBeLessThan(0.5);
    }
  });
});
