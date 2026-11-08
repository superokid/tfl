import { useState } from 'react';
import { NEAR_LINES } from '../../shared/config';
import { isLinesBody, type LineStatus } from '../../shared/api';
import type { VerdictKind } from '../../shared/rules/types';
import { lineColour } from '../lib/lineColours';
import { useLive, useServerNow } from '../hooks/live';
import { href } from '../hooks/route';
import type { SavedItem } from '../hooks/saved';
import { BusTab } from '../features/buses/Buses';
import { useIndex } from '../features/search/Search';
import { LinesSkeleton } from '../components/Skeletons';
import { LoadError, Retrying, StaleBanner, StatusText, Updated, useTitle } from '../components/ui';
import { formatDistance, rowNote, rowReason, sortLines, stationsNear, TABS, tabOf, tabSummary, type StationNear, type Tab } from '../lib/view';
import { useWhere, type Where } from '../hooks/where';

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
  useTitle(null);
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

  // Verdicts come from per-line checks anyone ran in the last 10 min (ADR-011).
  const checks = live.data?.checks ?? null;

  const age = live.data && now !== null ? now - live.data.checkedAt : null;
  const stale = !!live.data && (live.data.stale || live.source === 'device' || (age ?? 0) > 120_000);
  const alerts = live.data?.lines.filter((l) => isAlert(checks?.lines[l.lineId]?.verdict)) ?? [];
  const tabLabel = TABS.find((t) => t.id === tab)!.label;
  const inTab = live.data ? sortLines(live.data.lines.filter((l) => tabOf(l.mode) === tab)) : [];

  // "Lines near me": the position stays on the phone, matched against station positions in the index.
  const [where, locate, clearWhere] = useWhere({ bounds: null, auto: false });
  const index = useIndex(rail && where.state === 'at');
  const near =
    where.state === 'at' && index
      ? stationsNear(index.stations, { lat: Number(where.lat), lon: Number(where.lon) }, new Set(inTab.map((l) => l.lineId)), NEAR_LINES)
      : [];
  const nearLines = new Set(near.flatMap((s) => s.lines));
  const shown = near.length > 0 ? inTab.filter((l) => nearLines.has(l.lineId)) : inTab;

  return (
    <main className="home">
      {saved.length > 0 && (
        <nav className="block" aria-labelledby="saved-label">
          <h2 id="saved-label" className="label">
            Saved
          </h2>
          <div className="saved">
            {saved.map((s) => (
              <a key={`${s.route.page}:${s.route.id}`} className="chip" href={href(s.route)}>
                <span aria-hidden="true">★</span> <span className="chip-name">{s.name}</span>
              </a>
            ))}
          </div>
        </nav>
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
      ) : (
        <section className="block" aria-label={`${tabLabel} lines`}>
          <Updated age={age} stale={stale} loading={live.loading} paused={idle} onRefresh={live.reload} />
          <StaleBanner show={stale} deviceCopy={live.source === 'device'} age={age ?? 0} error={live.error} />
          <Retrying retry={live.retry} />
          {alerts.length > 0 && (
            <div className="alerts" role="group" aria-label="Live train alerts">
              {alerts.map((l) => (
                <a key={l.lineId} className="alert" href={href({ page: 'line', id: l.lineId })} style={{ borderLeftColor: lineColour(l.lineId) }}>
                  <strong>{l.lineName}</strong> {checks?.lines[l.lineId]?.summary}
                </a>
              ))}
            </div>
          )}
          {!live.data && (live.loading ? <LinesSkeleton /> : <LoadError error={live.error} onRetry={live.reload} what="line status" />)}
          {live.data && (
            <>
              <div className="near-top">
                <p className="tab-summary">{tabSummary(shown, tabLabel)}
                  {near.length > 0 && ' near you'}</p>
                <button type="button" className="button button-sm" aria-pressed={where.state !== 'off'} onClick={where.state === 'off' ? locate : clearWhere}>
                  {where.state === 'off' ? 'Lines near me' : 'All lines'}
                </button>
              </div>
              <NearNote where={where} index={index} near={near} tabLabel={tabLabel} />
              <ul className="lines">
                {shown.map((l) => (
                  <li key={l.lineId}>
                    <LineRow line={l} verdict={checks?.lines[l.lineId]?.verdict} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}

/** Which stations set the filter, or why every line is still shown. */
function NearNote({ where, index, near, tabLabel }: { where: Where; index: unknown; near: StationNear[]; tabLabel: string }) {
  const at = where.state === 'at';
  if (where.state === 'off') return null;
  if (!near.length)
    return (
      <p className="small muted near-note">
        {where.state === 'locating' || (at && index === undefined)
          ? 'Finding stations near you…'
          : `${at && index ? `No ${tabLabel} station within ${formatDistance(NEAR_LINES.farM)}` : at ? "Couldn't load stations" : "Couldn't get your location"}, so every line is shown.`}
      </p>
    );
  return (
    <div className="small near-stations">
      <span className="muted">Nearest stations</span>
      <ul>
        {near.map((s) => (
          <li key={s.id}>
            <a href={href({ page: 'station', id: s.id })}>{s.name}</a> <span className="muted">{formatDistance(s.distanceM)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const isAlert = (v: VerdictKind | undefined) => v === 'HIDDEN_DISRUPTION' || v === 'STALE_ALERT';

function LineRow({ line, verdict }: { line: LineStatus; verdict: VerdictKind | undefined }) {
  const note = rowNote(verdict);
  const reason = rowReason(line);
  return (
    <a className="line-row" href={href({ page: 'line', id: line.lineId })} style={{ borderLeftColor: lineColour(line.lineId) }}>
      <span className="line-name">{line.lineName}</span>
      <StatusText tflSays={line.tflSays} severity={line.severity} />
      {reason && <span className="row-reason">{reason}</span>}
      {note && <span className={`note note-${note.tone}`}>{note.text}</span>}
      <span className="chevron" aria-hidden="true">
        ›
      </span>
    </a>
  );
}
