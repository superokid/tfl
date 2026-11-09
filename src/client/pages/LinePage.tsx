import { Board } from '../features/boards/Board';
import { isLineBody, type LineBody } from '../../shared/api';
import { lineColour } from '../lib/lineColours';
import { useLive, useServerNow } from '../hooks/live';
import type { useSaved } from '../hooks/saved';
import { LineSkeleton } from '../components/Skeletons';
import { LoadError, PageHead, Retrying, SaveButton, StaleBanner, StatusText, Updated } from '../components/ui';
import { checkCard, evidenceText, formatIn, isOverThreshold, severityFromSays } from '../lib/view';

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
      <PageHead colour={lineColour(id)} title={line?.lineName ?? 'Line'} pending={!line && live.loading}>
        {line && <SaveButton item={{ route, name: line.lineName }} saved={saved.isSaved(route)} onToggle={saved.toggle} />}
      </PageHead>
      <Updated age={age} stale={!!line?.stale || live.source === 'device'} loading={live.loading} paused={idle} onRefresh={live.reload} />
      <StaleBanner show={!!line?.stale || live.source === 'device'} deviceCopy={live.source === 'device'} age={age ?? 0} error={live.error} />
      <Retrying retry={live.retry} />
      {!line && !live.loading && <LoadError error={live.error} onRetry={live.reload} what="this line" />}
      {!line && live.loading && <LineSkeleton />}
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
        <StatusText
          tflSays={line.tflSays}
          severity={severityFromSays(line.tflSays)}
          big
          closed={line.offHours ? { opensAt: line.opensAt ?? null, now } : undefined}
        />
        {line.offHours && typeof line.opensAt === 'number' && line.opensAt > now && (
          <p className="opens-in">First trains {formatIn(line.opensAt, now)}, from the timetable.</p>
        )}
        {line.messages.map((m) => (
          <p key={m} className="tfl-message">
            {m}
          </p>
        ))}
      </section>

      {!line.offHours && (
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
      )}

      {line.boards.length > 0 && (
        <section aria-label="Next trains">
          <h3 className="section-title">{line.offHours && line.boards.every((b) => b.directions.length === 0) ? 'First trains' : 'Next trains'}</h3>
          <p className="small muted section-sub">At the two stations we check. Search above for any other station.</p>
          <div className="boards">
            {line.boards.map((b) => (
              <Board key={b.stopId} board={b} now={now} />
            ))}
          </div>
        </section>
      )}
    </>
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
