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
