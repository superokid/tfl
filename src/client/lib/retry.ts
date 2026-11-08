/**
 * When a failed load is retried automatically: a few times with growing gaps, then the user taps
 * "Try again" (or the 60 s poll picks it up). Only failures a retry can fix: not 4xx (429 has its own
 * minute), a bad response, or offline (the browser's `online` event reloads).
 */
import { CLIENT } from '../../shared/config';
import type { LoadFailure } from './view';

/** Delay before retry number `attempt` (0-based), or null to give up. */
export function retryDelayMs(failure: LoadFailure, attempt: number): number | null {
  const transient = failure === 'network' || failure === 'timeout' || (typeof failure === 'number' && failure >= 500);
  return transient ? (CLIENT.retryDelaysMs[attempt] ?? null) : null;
}
