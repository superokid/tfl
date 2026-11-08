import type { LineReport } from '../shared/api';
import { lineColour } from './lineColours';
import { useStation } from './stations';
import { Times } from './Times';
import { useServerNow } from './useStatus';
import { badgeLabel, formatAge } from './view';

/** Live departures at one station, with each line's status and our verdict alongside. */
export function StationView({
  id,
  lines,
  paused,
  onBack,
}: {
  id: string;
  lines: LineReport[];
  paused: boolean;
  onBack: () => void;
}) {
  const { data, receivedAt, error, loading, reload } = useStation(id, paused);
  const now = useServerNow(data, receivedAt) ?? 0;
  const byId = new Map(lines.map((l) => [l.lineId, l]));

  return (
    <main className="station">
      <button type="button" className="back" onClick={onBack}>
        ← All lines
      </button>
      <h2 className="station-name">{data?.name ?? 'Station'}</h2>
      {data && (
        <p className="updated small">
          <span className={`dot ${data.stale ? 'dot-warn' : 'dot-live'}`} aria-hidden="true" />
          {data.stale ? 'Last updated' : 'Live · updated'} {formatAge(now - data.checkedAt)}
        </p>
      )}
      {data?.stale && (
        <div className="banner banner-warn" role="status">
          TfL isn't responding. Showing departures from {formatAge(now - data.checkedAt)}.
        </div>
      )}
      {!data && loading && <div className="skeleton skeleton-card" aria-hidden="true" />}
      {!data && !loading && (
        <div className="card empty" role="alert">
          <p>Can't load departures right now{error ? ` (${error})` : ''}.</p>
          <button className="button" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      )}
      {data?.lines.map(({ lineId, lineName, board }) => {
        const line = byId.get(lineId);
        return (
          <section key={lineId} className="card line" style={{ borderLeftColor: lineColour(lineId) }} aria-label={lineName}>
            <div className="line-head">
              <h3>
                <a href={`#${lineId}`} onClick={onBack}>
                  {lineName}
                </a>
              </h3>
              {line && <span className={`badge badge-${line.verdict.toLowerCase()}`}>{badgeLabel(line)}</span>}
            </div>
            {line && (
              <p className="says">
                <span className="muted">TfL says:</span> {line.tflSays || '—'}
              </p>
            )}
            {line?.messages.map((m) => (
              <p key={m} className="tfl-message small">
                {m}
              </p>
            ))}
            {!board.live ? (
              <p className="small muted">Live times unavailable right now.</p>
            ) : board.directions.length === 0 ? (
              <p className="small muted">No services predicted.</p>
            ) : (
              <div className="boards">
                {board.directions.map((d) => (
                  <div key={d.key} className="board">
                    <Times d={d} now={now} />
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </main>
  );
}
