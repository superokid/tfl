/**
 * Results fetched this session, per URL, kept for CLIENT.minRefetchGapMs. The server serves the same
 * snapshot for that long, so refetching sooner (tab switch, back to a screen, back online) only costs a
 * Worker request on the shared free-tier quota (ADR-009).
 */
import { CLIENT } from '../../shared/config';

const recent = new Map<string, { data: unknown; at: number }>();

const isRecent = (at: number, now: number) => now >= at && now - at < CLIENT.minRefetchGapMs;

export function remember(url: string, data: unknown, now: number): void {
  for (const [k, v] of recent) if (!isRecent(v.at, now)) recent.delete(k);
  recent.set(url, { data, at: now });
}

export function recall<T>(url: string, valid: (v: unknown) => v is T, now: number): { data: T; at: number } | null {
  const hit = recent.get(url);
  return hit && isRecent(hit.at, now) && valid(hit.data) ? { data: hit.data, at: hit.at } : null;
}

export function clearRecent(): void {
  recent.clear();
}

/** Whether a device copy saved at `savedAt` is fresh enough to show while the first fetch loads. */
export function showDeviceCopyWhileLoading(savedAt: number, now: number): boolean {
  return now >= savedAt && now - savedAt < CLIENT.maxDeviceCopyWhileLoadingMs;
}
