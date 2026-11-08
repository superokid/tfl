/**
 * Raw TfL JSON → the rules engine's domain model. Everything from the network is untrusted: a 200 with an
 * unexpected shape is a failure (TflError 'invalid'), and bad individual records are skipped.
 */
import { boundWord, cleanStationName } from '../../shared/reference/derive';
import type { Prediction, StatusInput } from '../../shared/rules/types';
import { TflError } from './client';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const time = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
};

/** /Line/Mode/{modes}/Status (optionally ?detail=true) → statuses per line id. */
export function parseStatuses(body: unknown): Map<string, StatusInput[]> {
  if (!Array.isArray(body)) throw new TflError('invalid', 'status: expected an array');
  const out = new Map<string, StatusInput[]>();
  for (const line of body) {
    if (!isObj(line) || !str(line.id) || !Array.isArray(line.lineStatuses)) continue;
    const statuses: StatusInput[] = [];
    for (const s of line.lineStatuses) {
      if (!isObj(s)) continue;
      const description = str(s.statusSeverityDescription);
      if (!description) continue;
      const validityPeriods = (Array.isArray(s.validityPeriods) ? s.validityPeriods : [])
        .map((p) => (isObj(p) ? { from: time(p.fromDate), to: time(p.toDate) } : null))
        .filter((p): p is { from: number; to: number } => p !== null && p.from !== null && p.to !== null);
      const stops = isObj(s.disruption) && Array.isArray(s.disruption.affectedStops) ? s.disruption.affectedStops : [];
      const affectedStopIds = stops.map((st) => (isObj(st) ? str(st.naptanId) : null)).filter((x): x is string => !!x);
      const reason = str(s.reason)?.trim().replace(/\s+/g, ' ') ?? null;
      statuses.push({ description, validityPeriods, affectedStopIds, reason });
    }
    out.set(line.id as string, statuses);
  }
  if (out.size === 0) throw new TflError('invalid', 'status: no lines');
  return out;
}

/**
 * /Line/{ids}/Arrivals/{stopId} → predictions per line id.
 * Direction: TfL `direction`, else learnt from another vehicle on the same platform in this response,
 * else the line's learnt compass mapping, else the platform itself (no reference → fallback gap).
 */
export function parseArrivals(
  body: unknown,
  stopId: string,
  boundDirections: Record<string, Record<string, string>>,
): Map<string, Prediction[]> {
  if (!Array.isArray(body)) throw new TflError('invalid', `arrivals ${stopId}: expected an array`);

  const platformDirection = new Map<string, string>();
  for (const a of body) {
    if (!isObj(a)) continue;
    const dir = str(a.direction);
    const platform = str(a.platformName);
    if (platform && (dir === 'inbound' || dir === 'outbound')) platformDirection.set(`${a.lineId}|${platform}`, dir);
  }

  const out = new Map<string, Prediction[]>();
  for (const a of body) {
    if (!isObj(a)) continue;
    const lineId = str(a.lineId);
    const vehicleId = str(a.vehicleId) ?? str(a.id);
    const expectedArrival = time(a.expectedArrival);
    if (!lineId || !vehicleId || expectedArrival === null) continue;
    const platform = str(a.platformName) ?? '';
    const bound = boundWord(platform);
    const direction =
      str(a.direction) ??
      platformDirection.get(`${lineId}|${platform}`) ??
      (bound ? boundDirections[lineId]?.[bound] : undefined) ??
      `platform:${platform}`;
    const timing = isObj(a.timing) ? a.timing : {};
    const destination = str(a.destinationNaptanId);
    const towards = str(a.towards);
    const destinationName = str(a.destinationName);
    out.set(lineId, [
      ...(out.get(lineId) ?? []),
      {
        vehicleId,
        directionKey: direction,
        directionLabel: bound ?? '',
        expectedArrival,
        // Unknown freshness is treated as frozen: we can't show it's live.
        timingRead: time(timing.read) ?? 0,
        confirmed: destination !== null || destinationName !== null,
        terminatesHere: destination === stopId,
        platform: platform && !/unknown/i.test(platform) ? platform : null,
        destination: destinationName
          ? cleanStationName(destinationName)
          : towards && !/check front of train/i.test(towards)
            ? towards
            : null,
      },
    ]);
  }
  return out;
}
