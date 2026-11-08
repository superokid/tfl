import { useMemo, useState } from 'react';
import { isLinesBody, isStatusBody, type CheckSummary, type LineStatus } from '../shared/api';
import type { VerdictKind } from '../shared/rules/types';
import { lineColour } from './lineColours';
import { href, useLive, useServerNow } from './live';
import type { SavedItem } from './saved';
import { BusTab } from './Buses';
import { LoadError, StaleBanner, StatusText, Updated } from './ui';
import { formatAge, rowNote, sortLines, TABS, tabOf, tabSummary, type Tab } from './view';

const TAB_KEY = 'tfl:tab';

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) ? (t as Tab) : 'tube';
  } catch {
    return 'tube';
  }
}

export function Home({ saved, idle }: { saved: SavedItem[]; idle: boolean }) {
  const [tab, setTabState] = useState<Tab>(readTab);
  // The Bus tab has its own data: rail statuses aren't fetched while it's open.
  const rail = tab !== 'bus';
  const live = useLive(rail ? '/api/lines' : null, isLinesBody, { paused: idle, saveAs: 'tfl:lines' });
  const now = useServerNow(live.data, live.receivedAt);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // not persisted
    }
  };

  // "Check all lines" runs only when asked (ADR-011); a recent result from anyone shows up for free.
  const [checkRequested, setCheckRequested] = useState(false);
  const check = useLive(checkRequested ? '/api/checks' : null, isStatusBody, { poll: false });
  const checks: CheckSummary | null = useMemo(() => {
    const fromCheck = check.data
      ? {
          checkedAt: check.data.checkedAt,
          lines: Object.fromEntries(check.data.lines.map((l) => [l.lineId, { verdict: l.verdict, reason: l.reason, summary: l.summary }])),
        }
      : null;
    const fromLines = live.data?.checks ?? null;
    return fromCheck && (!fromLines || fromCheck.checkedAt >= fromLines.checkedAt) ? fromCheck : fromLines;
  }, [check.data, live.data]);

  const age = live.data && now !== null ? now - live.data.checkedAt : null;
  const stale = !!live.data && (live.data.stale || live.source === 'device' || (age ?? 0) > 120_000);
  const alerts = live.data?.lines.filter((l) => isAlert(checks?.lines[l.lineId]?.verdict)) ?? [];
  const tabLabel = TABS.find((t) => t.id === tab)!.label;
  const inTab = live.data ? sortLines(live.data.lines.filter((l) => tabOf(l.mode) === tab)) : [];

  return (
    <main className="home">
      {saved.length > 0 && (
        <nav className="saved" aria-label="Saved">
          {saved.map((s) => (
            <a key={`${s.route.page}:${s.route.id}`} className="chip" href={href(s.route)}>
              <span aria-hidden="true">★</span> <span className="chip-name">{s.name}</span>
            </a>
          ))}
        </nav>
      )}

      {rail && <Updated age={age} stale={stale} loading={live.loading} paused={idle} onRefresh={live.reload} />}
      {rail && <StaleBanner show={stale} deviceCopy={live.source === 'device'} age={age ?? 0} error={live.error} />}

      {rail && alerts.length > 0 && (
        <section className="alerts" aria-label="Live train alerts">
          {alerts.map((l) => (
            <a key={l.lineId} className="alert" href={href({ page: 'line', id: l.lineId })} style={{ borderLeftColor: lineColour(l.lineId) }}>
              <strong>{l.lineName}</strong> {checks?.lines[l.lineId]?.summary}
            </a>
          ))}
        </section>
      )}

      <div className="tabs" role="tablist" aria-label="Transport mode">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} className="tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'bus' ? (
        <BusTab saved={saved} idle={idle} />
      ) : !live.data ? (
        live.loading ? (
          <Skeleton />
        ) : (
          <LoadError error={live.error} onRetry={live.reload} what="line status" />
        )
      ) : (
        <section aria-label={`${tabLabel} lines`}>
          <p className="tab-summary">{tabSummary(inTab, tabLabel)}</p>
          <ul className="lines">
            {inTab.map((l) => (
              <li key={l.lineId}>
                <LineRow line={l} verdict={checks?.lines[l.lineId]?.verdict} />
              </li>
            ))}
          </ul>
          <CheckAll
            checks={checks}
            now={now}
            running={check.loading && checkRequested}
            failed={!!check.error && checkRequested}
            onRun={() => (checkRequested ? check.reload() : setCheckRequested(true))}
          />
        </section>
      )}
    </main>
  );
}

const isAlert = (v: VerdictKind | undefined) => v === 'HIDDEN_DISRUPTION' || v === 'STALE_ALERT';

function LineRow({ line, verdict }: { line: LineStatus; verdict: VerdictKind | undefined }) {
  const note = rowNote(verdict);
  return (
    <a className="line-row" href={href({ page: 'line', id: line.lineId })} style={{ borderLeftColor: lineColour(line.lineId) }}>
      <span className="line-name">{line.lineName}</span>
      <StatusText tflSays={line.tflSays} severity={line.severity} />
      {note && <span className={`note note-${note.tone}`}>{note.text}</span>}
      <span className="chevron" aria-hidden="true">
        ›
      </span>
    </a>
  );
}

function CheckAll({
  checks,
  now,
  running,
  failed,
  onRun,
}: {
  checks: CheckSummary | null;
  now: number | null;
  running: boolean;
  failed: boolean;
  onRun: () => void;
}) {
  return (
    <div className="check-all">
      <button type="button" className="button" onClick={onRun} disabled={running}>
        {running ? 'Checking live trains…' : checks ? 'Check again' : 'Check every line against live trains'}
      </button>
      <p className="small muted">
        {failed
          ? "Couldn't run the check right now. Try again in a minute."
          : checks && now !== null
            ? `Checked ${formatAge(now - checks.checkedAt)}. Each line's status is compared with live arrivals at two stations.`
            : 'Compares each line’s status with live arrivals at two stations. Open a line to check just that one.'}
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}
