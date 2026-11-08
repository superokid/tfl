import type { LineReport } from '../shared/api';
import type { StationBoard } from '../shared/boards';
import { lineColour } from './lineColours';
import { useServerNow, useStatus } from './useStatus';
import { badgeLabel, evidenceText, formatAge, formatDue, groupLines, headline, isOverThreshold } from './view';

const STALE_AFTER_MS = 90_000;

export function App() {
  const { data, source, receivedAt, loading, error, reload } = useStatus();
  const now = useServerNow(data, receivedAt);
  const age = data && now !== null ? now - data.checkedAt : null;
  const groups = data ? groupLines(data.lines) : null;
  const head = groups ? headline(groups) : null;
  const outdated = data !== null && (data.stale || source === 'device' || (age ?? 0) > STALE_AFTER_MS);
  const allLines = data ? [...data.lines].sort((a, b) => a.lineName.localeCompare(b.lineName)) : [];

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Status vs Reality</h1>
          <p className="muted small">TfL line status, checked against live trains.</p>
        </div>
        <button className="refresh" onClick={() => void reload()} disabled={loading} aria-label="Refresh now">
          <span aria-hidden="true" className={loading ? 'spin' : ''}>
            ↻
          </span>
        </button>
      </header>

      <p className="updated small" aria-live="polite">
        {data && age !== null ? (
          <>
            <span className={`dot ${outdated ? 'dot-warn' : 'dot-live'}`} aria-hidden="true" />
            {outdated ? 'Last updated' : 'Live · updated'} {formatAge(age)}
          </>
        ) : loading ? (
          'Checking TfL…'
        ) : null}
      </p>

      {data && outdated && (
        <div className="banner banner-warn" role="status">
          {source === 'device'
            ? `${error ?? "Can't reach the service"}. Showing what this device last saw, from ${formatAge(age ?? 0)}.`
            : `TfL isn't responding. Showing information from ${formatAge(age ?? 0)}.`}
        </div>
      )}

      {!data && !loading && (
        <div className="card empty" role="alert">
          <p>Can't reach TfL right now{error ? ` (${error})` : ''}.</p>
          <button className="button" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      )}

      {!data && loading && <Skeleton />}

      {groups && head && now !== null && (
        <main>
          <p className={`headline headline-${head.tone}`}>{head.text}</p>

          {groups.mismatches.length > 0 && (
            <section aria-labelledby="h-mismatch" className="group">
              <h2 id="h-mismatch" className="section-title">
                Doesn't match what's running
              </h2>
              {groups.mismatches.map((l) => (
                <LineCard key={l.lineId} line={l} now={now} />
              ))}
            </section>
          )}

          <section className="group" aria-labelledby="h-all">
            <h2 id="h-all" className="section-title">
              All lines <span className="count">{allLines.length}</span>
            </h2>
            <ul className="rows">
              {allLines.map((l) => (
                <li key={l.lineId}>
                  <LineRow line={l} now={now} />
                </li>
              ))}
            </ul>
          </section>
        </main>
      )}

      <footer className="muted small">
        <p>
          Each line's official status is compared with live arrival predictions at two stations. A line is flagged
          only when both stations agree, against that line's own timetable.
        </p>
        <p>
          Powered by TfL Open Data. Not affiliated with TfL.
          {data && <> Timetables from {new Date(data.referenceGeneratedAt).toLocaleDateString('en-GB')}.</>}
        </p>
      </footer>
    </div>
  );
}

function LineCard({ line, now }: { line: LineReport; now: number }) {
  return (
    <article className="card line line-alert" style={{ borderLeftColor: lineColour(line.lineId) }}>
      <div className="line-head">
        <h3>{line.lineName}</h3>
        <span className={`badge badge-${line.verdict.toLowerCase()}`}>{badgeLabel(line)}</span>
      </div>
      <p className="summary">{line.summary}</p>
      <LineDetails line={line} now={now} />
    </article>
  );
}

/**
 * One compact, tappable row: colour, name, TfL's status, our verdict. Expands to the full picture.
 * `/#victoria` opens that line, so passengers can bookmark their own line.
 */
function LineRow({ line, now }: { line: LineReport; now: number }) {
  const linked = typeof location !== 'undefined' && location.hash === `#${line.lineId}`;
  return (
    <details id={line.lineId} className="row" style={{ borderLeftColor: lineColour(line.lineId) }} open={linked || undefined}>
      <summary>
        <span className="row-name">{line.lineName}</span>
        <span className="row-says muted">{line.tflSays || '—'}</span>
        <span className={`badge badge-${line.verdict.toLowerCase()}`}>{badgeLabel(line)}</span>
      </summary>
      <div className="row-body">
        <p className="summary">{line.summary}</p>
        <LineDetails line={line} now={now} />
      </div>
    </details>
  );
}

function LineDetails({ line, now }: { line: LineReport; now: number }) {
  return (
    <>
      {line.messages.length > 0 && (
        <div className="tfl-message">
          <p className="small muted">TfL says</p>
          {line.messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
      {line.boards.length > 0 && (
        <div className="boards">
          {line.boards.map((b) => (
            <Board key={b.stopId} board={b} now={now} />
          ))}
        </div>
      )}
      {line.evidence.length > 0 && (
        <details className="evidence">
          <summary className="small">How this was checked</summary>
          <Evidence line={line} />
        </details>
      )}
    </>
  );
}

function Board({ board, now }: { board: StationBoard; now: number }) {
  const directions = board.directions
    .map((d) => ({ ...d, arrivals: d.arrivals.filter((a) => a.at > now - 30_000) }))
    .filter((d) => d.arrivals.length > 0);
  return (
    <section className="board" aria-label={`Next trains at ${board.name}`}>
      <h4>{board.name}</h4>
      {!board.live ? (
        <p className="small muted">Live times unavailable right now.</p>
      ) : directions.length === 0 ? (
        <p className="small muted">No services predicted.</p>
      ) : (
        directions.map((d) => (
          <div key={d.key} className="board-dir">
            <p className="board-label small muted">{d.label}</p>
            <ol className="times">
              {d.arrivals.map((a, i) => (
                <li key={`${a.at}-${i}`}>
                  <span className="due">{formatDue(a.at, now)}</span>
                  <span className="dest">{a.destination ?? 'Check front of train'}</span>
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}

function Evidence({ line }: { line: LineReport }) {
  const stations = [...new Set(line.evidence.map((e) => e.stationName))];
  return (
    <>
      <ul className="evidence-list">
        {stations.map((name) => (
          <li key={name}>
            <strong>{name}</strong>
            <ul>
              {line.evidence
                .filter((e) => e.stationName === name)
                .map((e) => (
                  <li key={e.directionKey} className={isOverThreshold(e) ? 'over' : ''}>
                    {evidenceText(e)}
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Checked {new Date(line.checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true">
      <div className="skeleton skeleton-line" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}
