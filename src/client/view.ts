/** Pure display logic for the UI (unit-tested; components stay thin). */
import type { DirectionEvidence, LineVerdict, VerdictKind } from '../shared/rules/types';

export const MISMATCH: VerdictKind[] = ['HIDDEN_DISRUPTION', 'STALE_ALERT'];

export interface Groups<T extends LineVerdict = LineVerdict> {
  mismatches: T[];
  matches: T[];
  unchecked: T[];
  closed: T[];
}

const byName = (a: LineVerdict, b: LineVerdict) => a.lineName.localeCompare(b.lineName);

export function groupLines<T extends LineVerdict>(lines: T[]): Groups<T> {
  return {
    mismatches: lines.filter((l) => MISMATCH.includes(l.verdict)).sort(byName),
    matches: lines.filter((l) => l.verdict === 'MATCH').sort(byName),
    unchecked: lines.filter((l) => l.verdict === 'CANT_VERIFY').sort(byName),
    closed: lines.filter((l) => l.verdict === 'CLOSED').sort(byName),
  };
}

const lines = (n: number) => `${n} line${n === 1 ? '' : 's'}`;

export function headline(g: Groups): { tone: 'alert' | 'ok' | 'neutral'; text: string } {
  const total = g.mismatches.length + g.matches.length + g.unchecked.length + g.closed.length;
  if (g.mismatches.length > 0) {
    const n = g.mismatches.length;
    return { tone: 'alert', text: `${lines(n)} ${n === 1 ? "doesn't" : "don't"} match what's running` };
  }
  if (g.matches.length === total) return { tone: 'ok', text: `All ${total} lines match what's running` };
  if (g.closed.length > total / 2) return { tone: 'neutral', text: 'Most lines are closed right now' };
  const parts = [`${g.matches.length} of ${total} match`];
  if (g.unchecked.length) parts.push(`${g.unchecked.length} can't be checked`);
  if (g.closed.length) parts.push(`${g.closed.length} closed`);
  return { tone: g.matches.length > 0 ? 'ok' : 'neutral', text: parts.join(' · ') };
}

export const VERDICT_LABEL: Record<VerdictKind, string> = {
  HIDDEN_DISRUPTION: 'Worse than reported',
  STALE_ALERT: 'Status looks out of date',
  MATCH: 'Matches',
  CANT_VERIFY: "Can't verify",
  CLOSED: 'Closed',
};

/** Badge text: the verdict, except a single disagreeing station reads as "Mixed signals". */
export function badgeLabel(line: LineVerdict): string {
  return line.reason === 'mixed-evidence' ? 'Mixed signals' : VERDICT_LABEL[line.verdict];
}

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
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

const ISSUE_TEXT: Record<NonNullable<DirectionEvidence['issue']>, string> = {
  failed: "TfL didn't respond",
  invalid: 'TfL sent an unreadable response',
  budget: 'not checked this time (call limit)',
  'no-predictions': 'no services predicted',
  frozen: 'predictions not updating',
  'short-horizon': 'predictions too short to judge',
  'outside-hours': 'outside operating hours',
  'day-edge': 'service starting or ending',
};

const mins = (x: number) => `${Math.round(x)} min`;

/** One evidence row in plain English, e.g. "southbound: 14 min wait (usually 3 min)". */
export function evidenceText(e: DirectionEvidence): string {
  const dir = e.directionLabel || (e.directionKey.startsWith('platform:') ? e.directionKey.slice(9) : e.directionKey === '*' ? 'all directions' : e.directionKey);
  if (!e.usable || e.observedGapMin === null) return `${dir}: ${e.issue ? ISSUE_TEXT[e.issue] : 'no data'}`;
  const usual = `usually ${mins(e.normalGapMin)}${e.normalGapIsFallback ? ', estimated' : ''}`;
  const start = Math.round(e.gapStartMin ?? 0);
  const what =
    e.gapKind === 'next' ? `next in ${mins(e.observedGapMin)}` : `${mins(e.observedGapMin)} gap${start > 0 ? ` from ${start} min` : ''}`;
  return `${dir}: ${what} (${usual})`;
}

export function isOverThreshold(e: DirectionEvidence): boolean {
  return e.usable && e.observedGapMin !== null && e.observedGapMin > e.thresholdMin;
}
