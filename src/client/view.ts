/** Pure display logic (unit-tested; components stay thin). Plain words for passengers, no internal jargon. */
import type { LineStatus } from '../shared/api';
import type { Mode } from '../shared/config';
import { mapStatus } from '../shared/rules/status';
import type { DirectionEvidence, Expected, VerdictKind, VerdictReason } from '../shared/rules/types';

// ── Modes ───────────────────────────────────────────────────────────────────────────────────────────

export type Tab = 'tube' | 'elizabeth-line' | 'overground' | 'dlr' | 'tram' | 'bus';

export const TABS: { id: Tab; label: string }[] = [
  { id: 'tube', label: 'Tube' },
  { id: 'elizabeth-line', label: 'Elizabeth line' },
  { id: 'overground', label: 'Overground' },
  { id: 'dlr', label: 'DLR' },
  { id: 'tram', label: 'Tram' },
  { id: 'bus', label: 'Bus' },
];

/** The cable car sits with the tram: both are small, separate services. */
export const tabOf = (mode: Mode): Tab => (mode === 'cable-car' ? 'tram' : mode === 'bus' ? 'bus' : mode);

// ── Status ──────────────────────────────────────────────────────────────────────────────────────────

export type Tone = 'good' | 'minor' | 'major' | 'closed' | 'unknown';

export function statusTone(severity: Expected | null): Tone {
  switch (severity) {
    case 'NORMAL':
      return 'good';
    case 'MINOR':
      return 'minor';
    case 'DEGRADED':
    case 'PARTIAL':
      return 'major';
    case 'NONE':
    case 'CLOSED':
      return 'closed';
    default:
      return 'unknown';
  }
}

/** "Severe Delays, Part Suspended" → "Severe delays · Part suspended" (sentence case, as TfL's site). */
export function prettyStatus(tflSays: string): string {
  if (!tflSays) return 'No status from TfL';
  return tflSays
    .split(', ')
    .map((s) => s.charAt(0) + s.slice(1).toLowerCase())
    .join(' · ');
}

const SEVERITY_ORDER: (Expected | null)[] = ['CLOSED', 'NONE', 'PARTIAL', 'DEGRADED', 'MINOR', null, 'NORMAL'];

/** Worst expectation in TfL's status text ("Severe Delays, Part Suspended" → PARTIAL); null if unknown. */
export function severityFromSays(tflSays: string): Expected | null {
  const mapped = tflSays ? tflSays.split(', ').map(mapStatus) : [];
  if (mapped.length === 0 || mapped.includes(null)) return null;
  return (mapped as Expected[]).reduce((worst, e) => (SEVERITY_ORDER.indexOf(e) < SEVERITY_ORDER.indexOf(worst) ? e : worst));
}

/** Problems first (worst first), then alphabetical: as TfL's own status page. */
export function sortLines<T extends Pick<LineStatus, 'lineName' | 'severity'>>(lines: T[]): T[] {
  return [...lines].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.lineName.localeCompare(b.lineName),
  );
}

/** One line under the tabs: "Good service on all Tube lines" or "2 lines have problems". */
export function tabSummary(lines: Pick<LineStatus, 'severity'>[], tabLabel: string): string {
  const problems = lines.filter((l) => l.severity !== 'NORMAL').length;
  if (lines.length === 0) return '';
  if (problems === 0) return lines.length === 1 ? 'Good service' : `Good service on all ${tabLabel} lines`;
  return `${problems} ${problems === 1 ? 'line has' : 'lines have'} problems`;
}

// ── Live check (our comparison), in plain words ────────────────────────────────────────────────────

export interface CheckNote {
  tone: 'ok' | 'alert' | 'muted';
  text: string;
}

/** Short note for a list row; null when it adds nothing (can't check, closed). */
export function rowNote(verdict: VerdictKind | undefined): CheckNote | null {
  switch (verdict) {
    case 'HIDDEN_DISRUPTION':
      return { tone: 'alert', text: 'Live trains: longer waits than TfL says' };
    case 'STALE_ALERT':
      return { tone: 'alert', text: 'Live trains: running, status may be out of date' };
    case 'MATCH':
      return { tone: 'ok', text: 'Live trains match' };
    default:
      return null;
  }
}

const REASON_TEXT: Record<VerdictReason, string> = {
  'status-only': "Live times aren't published for this line, so it can't be checked.",
  'unknown-status': "TfL's status here isn't one we can check against trains.",
  'partial-unlocated': "TfL hasn't said which part of the line is affected, so it can't be checked.",
  'insufficient-data': 'Not enough live train data to check right now.',
  'fallback-gap': "TfL doesn't publish a timetable for this line, so waits can't be compared with normal.",
  'mixed-evidence': '',
  'planned-closure': 'TfL has planned a closure.',
  'outside-hours': 'Outside service hours.',
};

/** Heading and explanation for the line page's "Live check" card. */
export function checkCard(verdict: VerdictKind, reason: VerdictReason | null, summary: string): CheckNote & { detail: string } {
  switch (verdict) {
    case 'HIDDEN_DISRUPTION':
      return { tone: 'alert', text: 'Longer waits than TfL says', detail: summary };
    case 'STALE_ALERT':
      return { tone: 'alert', text: 'Trains are running: status may be out of date', detail: summary };
    case 'MATCH':
      return { tone: 'ok', text: 'Live trains match this status', detail: summary };
    case 'CLOSED':
      return { tone: 'muted', text: 'Closed', detail: reason ? REASON_TEXT[reason] : summary };
    default:
      return {
        tone: 'muted',
        text: reason === 'mixed-evidence' ? 'Mixed picture from live trains' : "Couldn't check with live trains",
        detail: reason && REASON_TEXT[reason] ? REASON_TEXT[reason] : summary,
      };
  }
}

// ── Times ───────────────────────────────────────────────────────────────────────────────────────────

/** Arrival countdown: "Due" within 30 s, else whole minutes ("1 min", "12 min"). */
export function formatDue(at: number, now: number): string {
  const ms = at - now;
  if (ms <= 30_000) return 'Due';
  return `${Math.max(1, Math.round(ms / 60_000))} min`;
}

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

// ── Evidence ("How we checked") ─────────────────────────────────────────────────────────────────────

const ISSUE_TEXT: Record<NonNullable<DirectionEvidence['issue']>, string> = {
  failed: "TfL didn't respond",
  invalid: 'TfL sent an unreadable response',
  budget: 'not checked this time',
  'no-predictions': 'no trains predicted',
  frozen: 'predictions not updating',
  'short-horizon': 'predictions too short to judge',
  'outside-hours': 'outside service hours',
  'day-edge': 'service starting or ending',
};

const mins = (x: number) => `${Math.round(x)} min`;

/** One evidence row, e.g. "Southbound: 12 min gap from 7 min (usually 3 min)". */
export function evidenceText(e: DirectionEvidence): string {
  const raw =
    e.directionLabel ||
    (e.directionKey.startsWith('platform:') ? e.directionKey.slice(9) : e.directionKey === '*' ? 'all directions' : e.directionKey);
  const dir = raw.charAt(0).toUpperCase() + raw.slice(1);
  if (!e.usable || e.observedGapMin === null) return `${dir}: ${e.issue ? ISSUE_TEXT[e.issue] : 'no data'}`;
  const usual = `usually ${mins(e.normalGapMin)}${e.normalGapIsFallback ? ', estimated' : ''}`;
  const start = Math.round(e.gapStartMin ?? 0);
  const what =
    e.gapKind === 'next' ? `next in ${mins(e.observedGapMin)}` : `${mins(e.observedGapMin)} gap${start > 0 ? ` from ${start} min` : ''}`;
  return `${dir}: ${what} (${usual})`;
}

export const isOverThreshold = (e: DirectionEvidence) =>
  e.usable && e.observedGapMin !== null && e.observedGapMin > e.thresholdMin;

// ── Search ──────────────────────────────────────────────────────────────────────────────────────────

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Ranks by name: starts with the query, then a word starts with it, then contains it. */
export function searchByName<T extends { name: string }>(items: T[], query: string, limit = 6): T[] {
  const q = normalise(query);
  if (!q) return [];
  const scored: { item: T; rank: number }[] = [];
  for (const item of items) {
    const n = normalise(item.name);
    const rank = n.startsWith(q) ? 0 : n.split(' ').some((w) => w.startsWith(q)) ? 1 : n.includes(q) ? 2 : -1;
    if (rank >= 0) scored.push({ item, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name, 'en', { numeric: true }))
    .slice(0, limit)
    .map((x) => x.item);
}

/** Bus routes for a query like "38", "n3" or "SL": exact match first, then by number. */
export function searchRoutes<T extends { name: string }>(routes: T[], query: string, limit = 6): T[] {
  const q = query.trim().toLowerCase();
  if (!q || q.length > 4 || !/^[a-z]{0,2}\d*[a-z]?$/.test(q)) return [];
  return routes
    .filter((r) => r.name.toLowerCase().startsWith(q))
    .sort((a, b) =>
      a.name.toLowerCase() === q ? -1 : b.name.toLowerCase() === q ? 1 : a.name.localeCompare(b.name, 'en', { numeric: true }),
    )
    .slice(0, limit);
}
