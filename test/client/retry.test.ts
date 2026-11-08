import { describe, expect, it } from 'vitest';
import { retryDelayMs } from '../../src/client/lib/retry';
import { CLIENT } from '../../src/shared/config';

describe('automatic retry after a failed load', () => {
  it('retries passing failures with growing delays', () => {
    expect(CLIENT.retryDelaysMs.map((_, i) => retryDelayMs('network', i))).toEqual([...CLIENT.retryDelaysMs]);
    expect(retryDelayMs('timeout', 0)).toBe(CLIENT.retryDelaysMs[0]);
    expect(retryDelayMs(503, 0)).toBe(CLIENT.retryDelaysMs[0]);
    expect(retryDelayMs(502, 0)).toBe(CLIENT.retryDelaysMs[0]);
  });

  it('stops after the last delay, not indefinitely', () => {
    expect(retryDelayMs('network', CLIENT.retryDelaysMs.length)).toBeNull();
    expect(retryDelayMs(503, 99)).toBeNull();
  });

  it("doesn't retry what a retry won't fix", () => {
    for (const f of [404, 400, 429, 'invalid', 'offline'] as const) expect(retryDelayMs(f, 0)).toBeNull();
  });
});
