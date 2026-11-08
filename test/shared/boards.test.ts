import { describe, expect, it } from 'vitest';
import { buildBoard, lineMessages } from '../../src/shared/boards';
import { MIN, preds, TUE_10AM } from '../rules/builders';

const now = TUE_10AM;

describe('buildBoard', () => {
  it('next 4 per direction, soonest first, with destinations', () => {
    const p = [
      ...preds(now, [9, 1, 5, 13, 17], 'outbound', 'southbound', 0.5, { destination: 'Brixton' }),
      ...preds(now, [2, 6], 'inbound', 'northbound', 0.5, { destination: 'Walthamstow Central' }),
    ];
    const b = buildBoard('s', 'Oxford Circus', p, now);
    expect(b.live).toBe(true);
    expect(b.directions.map((d) => d.label)).toEqual(['Northbound', 'Southbound']);
    const south = b.directions[1]!;
    expect(south.arrivals.map((a) => (a.at - now) / MIN)).toEqual([1, 5, 9, 13]);
    expect(south.arrivals[0]!.destination).toBe('Brixton');
  });

  it('groups by physical platform, not TfL direction (Elizabeth line at Stratford)', () => {
    const p = [
      ...preds(now, [3, 11], 'outbound', '', 0.5, { platform: 'Platform 5', destination: 'Paddington' }),
      // TfL marks these eastbound trains "outbound" too.
      ...preds(now, [14, 29], 'outbound', '', 0.5, { platform: 'Platform 8', destination: 'Gidea Park' }),
    ].map((x, i) => ({ ...x, vehicleId: `v${i}` }));
    const labels = buildBoard('s', 'Stratford', p, now).directions.map((d) => d.label);
    expect(labels).toEqual(['Platform 5 · towards Paddington', 'Platform 8 · towards Gidea Park']);
  });

  it('unknown-platform services join the platform with the same destination, never a guessed group', () => {
    const known = preds(now, [3], 'outbound', '', 0.5, { platform: 'Platform 5', destination: 'Paddington' });
    const unknown = preds(now, [48], 'outbound', '', 0.5, { destination: 'Paddington' }).map((x) => ({ ...x, vehicleId: 'u1' }));
    const stray = preds(now, [50], 'outbound', '', 0.5, { destination: 'Somewhere' }).map((x) => ({ ...x, vehicleId: 'u2' }));
    const b = buildBoard('s', 'Stratford', [...known, ...unknown, ...stray], now);
    expect(b.directions).toHaveLength(1);
    expect(b.directions[0]!.arrivals).toHaveLength(2);
  });

  it('a terminus merges its terminating platforms into one group', () => {
    const p = [
      ...preds(now, [1, 5], 'inbound', 'westbound', 0.5, { platform: 'Westbound - Platform 13', terminatesHere: true }),
      ...preds(now, [3], 'inbound', 'westbound', 0.5, { platform: 'Westbound - Platform 14', terminatesHere: true }),
    ].map((x, i) => ({ ...x, vehicleId: `t${i}` }));
    const b = buildBoard('s', 'Stratford', p, now);
    expect(b.directions.map((d) => d.label)).toEqual(['Westbound · trains terminating here']);
    expect(b.directions[0]!.arrivals).toHaveLength(3);
  });

  it('compass platforms keep the compass word first', () => {
    const p = preds(now, [2], 'outbound', 'northbound', 0.5, { platform: 'Northbound - Platform 1' });
    expect(buildBoard('s', 'X', p, now).directions[0]!.label).toBe('Northbound · Platform 1');
  });

  it('marks trains that terminate here', () => {
    const p = preds(now, [2], 'inbound', 'westbound', 0.5, { terminatesHere: true, destination: 'Stratford' });
    expect(buildBoard('s', 'Stratford', p, now).directions[0]!.arrivals[0]!.terminates).toBe(true);
  });

  it('no compass word: labels by most common destination', () => {
    const p = preds(now, [2, 7], 'outbound', '', 0.5, { destination: 'Abbey Wood' });
    expect(buildBoard('s', 'Bond Street', p, now).directions[0]!.label).toBe('Towards Abbey Wood');
  });

  it('drops departed trains and lists a vehicle once', () => {
    const p = preds(now, [-2, 3], 'outbound', 'southbound');
    const dup = { ...p[1]!, expectedArrival: now + 9 * MIN };
    expect(buildBoard('s', 'X', [...p, dup], now).directions[0]!.arrivals).toHaveLength(1);
  });

  it('a failed call is not an empty board', () => {
    expect(buildBoard('s', 'X', null, now)).toEqual({ stopId: 's', name: 'X', live: false, directions: [] });
  });
});

describe('lineMessages', () => {
  it('de-duplicates and drops the "<Line> Line:" prefix', () => {
    const r = "Bakerloo Line: No service between Queen's Park and Harrow & Wealdstone.";
    expect(lineMessages('Bakerloo', [r, r, null])).toEqual(["No service between Queen's Park and Harrow & Wealdstone."]);
  });
  it('handles names with regex characters', () => {
    expect(lineMessages('Hammersmith & City', ['Hammersmith & City Line: Minor delays.'])).toEqual(['Minor delays.']);
  });
});
