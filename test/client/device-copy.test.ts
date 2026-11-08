import { describe, expect, it } from 'vitest';
import { showDeviceCopyWhileLoading } from '../../src/client/lib/recent';
import { CLIENT } from '../../src/shared/config';

describe('device copy while the first fetch is in flight', () => {
  it('shows a recent copy at once', () => {
    expect(showDeviceCopyWhileLoading(1_000, 1_000 + CLIENT.maxDeviceCopyWhileLoadingMs - 1)).toBe(true);
  });

  it('shows a skeleton instead of a copy that is too old', () => {
    expect(showDeviceCopyWhileLoading(1_000, 1_000 + CLIENT.maxDeviceCopyWhileLoadingMs)).toBe(false);
    expect(showDeviceCopyWhileLoading(0, 60 * 60_000)).toBe(false);
  });

  it('distrusts a copy saved in the future (clock changed)', () => {
    expect(showDeviceCopyWhileLoading(2_000, 1_000)).toBe(false);
  });
});
