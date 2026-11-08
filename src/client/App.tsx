import type { LineVerdict } from '../shared/rules/types';
import { lineColour } from './lineColours';
import { useAge, useStatus } from './useStatus';
import { badgeLabel, evidenceText, formatAge, groupLines, headline, isOverThreshold } from './view';

const STALE_AFTER_MS = 90_000;

export function App() {
  const { data, source, receivedAt, loading, error, reload } = useStatus();
  const age = useAge(data, receivedAt);
  const groups = data ? groupLines(data.lines) : null;
  const head = groups ? headline(groups) : null;
  const outdated = data !== null && (data.stale || source === 'device' || (age ?? 0) > STALE_AFTER_MS);

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Status vs Reality</h1>
          <p className="muted small">Is TfL's line status telling the truth right now?</p>
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

      {groups && head && (
        <main>
          <p className={`headline headline-${head.tone}`}>{head.text}</p>

          {groups.mismatches.length > 0 && (
            <section aria-labelledby="h-mismatch">
              <h2 id="h-mismatch" className="section-title">
                Doesn't match
              </h2>
              {groups.mismatches.map((l) => (
                <LineCard key={l.lineId} line={l} />
              ))}
            </section>
          )}

          <LineGroup title="Matches what's running" lines={groups.matches} />
          <LineGroup title="Can't verify" lines={groups.unchecked} />
          <LineGroup title="Closed" lines={groups.closed} />
        </main>
      )}

      <footer className="muted small">
        <p>
          Compares TfL's official status with its live arrival predictions at two stations per line. A line is
          flagged only when both stations agree.
        </p>
        <p>
          Powered by TfL Open Data. Not affiliated with TfL.
          {data && <> Timetables from {new Date(data.referenceGeneratedAt).toLocaleDateString('en-GB')}.</>}
        </p>
      </footer>
    </div>
  );
}

function LineCard({ line }: { line: LineVerdict }) {
  return (
    <article className="card line line-alert" style={{ borderLeftColor: lineColour(line.lineId) }}>
      <div className="line-head">
        <h3>{line.lineName}</h3>
        <span className={`badge badge-${line.verdict.toLowerCase()}`}>{badgeLabel(line)}</span>
      </div>
      <p className="says">
        <span className="muted">TfL says:</span> {line.tflSays || '—'}
      </p>
      <p className="summary">{line.summary}</p>
      <details className="evidence">
        <summary className="small">Evidence</summary>
        <Evidence line={line} />
      </details>
    </article>
  );
}

function LineGroup({ title, lines }: { title: string; lines: LineVerdict[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="group" aria-label={title}>
      <h2 className="section-title">
        {title} <span className="count">{lines.length}</span>
      </h2>
      <ul className="rows">
        {lines.map((l) => (
          <li key={l.lineId}>
            <LineRow line={l} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One compact, tappable row: colour, name, what TfL says, verdict. Expands to the sentence and evidence. */
function LineRow({ line }: { line: LineVerdict }) {
  return (
    <details className="row" style={{ borderLeftColor: lineColour(line.lineId) }}>
      <summary>
        <span className="row-name">{line.lineName}</span>
        <span className="row-says muted">{line.tflSays || '—'}</span>
        <span className={`badge badge-${line.verdict.toLowerCase()}`}>{badgeLabel(line)}</span>
      </summary>
      <div className="row-body">
        <p className="summary">{line.summary}</p>
        <Evidence line={line} />
      </div>
    </details>
  );
}

function Evidence({ line }: { line: LineVerdict }) {
  const stations = [...new Set(line.evidence.map((e) => e.stationName))];
  if (stations.length === 0) return null;
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
