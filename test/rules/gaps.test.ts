import { describe, expect, it } from 'vitest';
import { analyseDirection } from '../../src/shared/rules/gaps';
import { at, every, MIN, preds, TUE_10AM } from './builders';

const now = TUE_10AM;

describe('analyseDirection (SPEC §5.2)', () => {
  it('regular frequent service is usable and within threshold', () => {
    const r = analyseDirection(preds(now, every(3, 30)), now, 3);
    expect(r).toMatchObject({ usable: true, issue: null, thresholdMin: 8 });
    expect(r.observedGapMin).toBeCloseTo(3);
  });

  it('threshold is max(2 × normal, normal + 5)', () => {
    expect(analyseDirection(preds(now, every(3)), now, 3).thresholdMin).toBe(8);
    expect(analyseDirection(preds(now, every(15)), now, 15).thresholdMin).toBe(30);
  });

  it('counts now → first arrival as a gap ("next train is 14 min away")', () => {
    const r = analyseDirection(preds(now, [14, 17, 20]), now, 3);
    expect(r).toMatchObject({ usable: true, gapKind: 'next' });
    expect(r.observedGapMin).toBeCloseTo(14);
  });

  it('finds the largest gap between consecutive arrivals', () => {
    const r = analyseDirection(preds(now, [1, 4, 7, 19, 22, 25]), now, 3);
    expect(r).toMatchObject({ gapKind: 'between' });
    expect(r.observedGapMin).toBeCloseTo(12);
  });

  it('frequent service (normal ≤ 5): ignores gaps beyond the 30 min window', () => {
    const r = analyseDirection(preds(now, [...every(3, 30), 50]), now, 3);
    expect(r.observedGapMin).toBeCloseTo(3);
  });

  it('counts the wait from the last in-window train to the window end when later trains exist', () => {
    // A train in 1 min, then nothing until 40: passengers wait ≥ 29 min, even though 40 is beyond the window.
    const r = analyseDirection(preds(now, [1, 40, 43]), now, 3);
    expect(r).toMatchObject({ usable: true, gapKind: 'between' });
    expect(r.observedGapMin).toBeCloseTo(29);
  });

  it('infrequent service (normal > 5): looks 60 min ahead', () => {
    const r = analyseDirection(preds(now, [5, 20, 55]), now, 15);
    expect(r.observedGapMin).toBeCloseTo(35);
  });

  it('cuts the window to the horizon and never invents a gap after the last prediction', () => {
    const r = analyseDirection(preds(now, [2, 5, 8]), now, 3);
    expect(r.horizonMin).toBeCloseTo(8);
    expect(r.observedGapMin).toBeCloseTo(3);
  });

  it('short horizon with no long gap seen is unusable', () => {
    const r = analyseDirection(preds(now, [1, 4]), now, 3); // horizon 4 < 2 × 3? no: 4 < 6
    expect(r).toMatchObject({ usable: false, issue: 'short-horizon', observedGapMin: null });
  });

  it('short horizon is still usable when it already shows an over-threshold gap', () => {
    const r = analyseDirection(preds(now, [12]), now, 3);
    expect(r).toMatchObject({ usable: true, gapKind: 'next' });
  });

  it('no predictions is unusable, never "no service"', () => {
    expect(analyseDirection([], now, 3)).toMatchObject({ usable: false, issue: 'no-predictions' });
  });

  it('a frozen feed (timing.read > 3 min old) is unusable', () => {
    const r = analyseDirection(preds(now, every(3), 'outbound', 'southbound', 4), now, 3);
    expect(r).toMatchObject({ usable: false, issue: 'frozen' });
  });

  it('de-duplicates a vehicle listed twice', () => {
    const p = preds(now, [1, 4, 7, 10]);
    const dup = { ...p[1]!, expectedArrival: at(now, 16) }; // same vehicle, later duplicate
    const r = analyseDirection([...p, dup], now, 3);
    expect(r.observedGapMin).toBeCloseTo(3);
  });

  it('treats an arrival already due (in the past) as now', () => {
    const p = preds(now, [2, 5, 8]);
    p[0] = { ...p[0]!, expectedArrival: now - MIN };
    const r = analyseDirection(p, now, 3);
    expect(r.observedGapMin).toBeCloseTo(5);
  });
});
