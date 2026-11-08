import { isLineBody, type LineBody } from '../shared/api';
import type { StationBoard } from '../shared/boards';
import { lineColour } from './lineColours';
import { href, useLive, useServerNow } from './live';
import type { useSaved } from './saved';
import { Times } from './Times';
import { LoadError, PageHead, SaveButton, StaleBanner, StatusText, Updated } from './ui';
import { checkCard, evidenceText, isOverThreshold, severityFromSays } from './view';

/**
 * One line: TfL's status and message, our live check in plain words, and next trains. Fetched on open;
 * the phone's last copy shows at once (marked with its age) while the slow live check loads.
 */
export function LinePage({ id, saved, idle }: { id: string; saved: ReturnType<typeof useSaved>; idle: boolean }) {
  const live = useLive(`/api/line/${id}`, isLineBody, { paused: idle, saveAs: `tfl:line:${id}` });
  const now = useServerNow(live.data, live.receivedAt);
  const line = live.data;
  const age = line && now !== null ? now - line.checkedAt : null;
  const route = { page: 'line' as const, id };

  return (
    <main className="detail">
      <PageHead colour={lineColour(id)} title={line?.lineName ?? 'Line'}>
        {line && <SaveButton item={{ route, name: line.lineName }} saved={saved.isSaved(route)} onToggle={saved.toggle} />}
      </PageHead>
      <Updated age={age} stale={!!line?.stale || live.source === 'device'} loading={live.loading} paused={idle} onRefresh={live.reload} />
      <StaleBanner show={!!line?.stale || live.source === 'device'} deviceCopy={live.source === 'device'} age={age ?? 0} error={live.error} />
      {!line && !live.loading && <LoadError error={live.error} onRetry={live.reload} what="this line" />}
      {!line && live.loading && <div className="skeleton skeleton-card" aria-hidden="true" />}
      {line && now !== null && <LineBodyView line={line} now={now} />}
    </main>
  );
}

function LineBodyView({ line, now }: { line: LineBody; now: number }) {
  const card = checkCard(line.verdict, line.reason, line.summary);
  return (
    <>
      <section className="card">
        <p className="small muted">TfL says</p>
        <StatusText tflSays={line.tflSays} severity={severityFromSays(line.tflSays)} big />
        {line.messages.map((m) => (
          <p key={m} className="tfl-message">
            {m}
          </p>
        ))}
      </section>

      <section className={`card check check-${card.tone}`} aria-label="Live check">
        <p className="small muted">Live trains</p>
        <p className="check-title">{card.text}</p>
        {card.detail && <p>{card.detail}</p>}
        {line.evidence.length > 0 && (
          <details className="evidence">
            <summary className="small">How we checked</summary>
            <Evidence line={line} />
          </details>
        )}
      </section>

      {line.boards.length > 0 && (
        <section aria-label="Next trains">
          <h3 className="section-title">Next trains</h3>
          <div className="boards">
            {line.boards.map((b) => (
              <Board key={b.stopId} board={b} now={now} />
            ))}
          </div>
          <p className="small muted">
            Live times at the two stations we check. Search any station above for its departures.
          </p>
        </section>
      )}
    </>
  );
}

export function Board({ board, now, link = true }: { board: StationBoard; now: number; link?: boolean }) {
  const directions = board.directions.filter((d) => d.arrivals.some((a) => a.at > now - 30_000));
  return (
    <section className="board" aria-label={`Next trains at ${board.name}`}>
      {link && (
        <h4>
          <a href={href({ page: 'station', id: board.stopId })}>{board.name}</a>
        </h4>
      )}
      {!board.live ? (
        <p className="small muted">Live times unavailable right now.</p>
      ) : directions.length === 0 ? (
        <p className="small muted">No services predicted.</p>
      ) : (
        directions.map((d) => <Times key={d.key} d={d} now={now} />)
      )}
    </section>
  );
}

function Evidence({ line }: { line: LineBody }) {
  const stations = [...new Set(line.evidence.map((e) => e.stationName))];
  return (
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
  );
}
