import { beforeEach, describe, expect, it } from 'vitest';
import { clearRecent, recall, remember } from '../../src/client/lib/recent';
import { CLIENT } from '../../src/shared/config';

const isNum = (v: unknown): v is number => typeof v === 'number';
const isStr = (v: unknown): v is string => typeof v === 'string';

describe('recent fetches (client, saves Worker requests)', () => {
  beforeEach(() => clearRecent());

  it('returns a result fetched under the gap ago', () => {
    remember('/api/lines', 1, 1_000);
    expect(recall('/api/lines', isNum, 1_000 + CLIENT.minRefetchGapMs - 1)).toEqual({ data: 1, at: 1_000 });
  });

  it('forgets it once the gap has passed, so polling still fetches', () => {
    remember('/api/lines', 1, 1_000);
    expect(recall('/api/lines', isNum, 1_000 + CLIENT.minRefetchGapMs)).toBeNull();
  });

  it('is per URL', () => {
    remember('/api/line/victoria', 1, 0);
    expect(recall('/api/line/central', isNum, 1)).toBeNull();
  });

  it('ignores a result that fails validation', () => {
    remember('/api/lines', 1, 0);
    expect(recall('/api/lines', isStr, 1)).toBeNull();
  });

  it('never trusts a clock that went backwards', () => {
    remember('/api/lines', 1, 10_000);
    expect(recall('/api/lines', isNum, 5_000)).toBeNull();
  });

  it('drops expired entries when adding new ones', () => {
    remember('/a', 1, 0);
    remember('/b', 2, CLIENT.minRefetchGapMs + 1);
    expect(recall('/a', isNum, 0)).toBeNull();
    expect(recall('/b', isNum, CLIENT.minRefetchGapMs + 1)).toEqual({ data: 2, at: CLIENT.minRefetchGapMs + 1 });
  });
});
