import { isLinesBody, isStationBody, type LinesBody } from '../shared/api';
import type { StationBoard } from '../shared/boards';
import { lineColour } from './lineColours';
import { href, useLive, useServerNow } from './live';
import type { useSaved } from './saved';
import { Board } from './LinePage';
import { LoadError, PageHead, SaveButton, StaleBanner, StatusText, Updated } from './ui';
import { formatDue } from './view';

/** The home screen's last statuses, from this device: shows each line's status here for free. */
function savedLines(): LinesBody | null {
  try {
    const v = (JSON.parse(localStorage.getItem('tfl:lines') ?? 'null') as { data?: unknown } | null)?.data;
    return isLinesBody(v) ? v : null;
  } catch {
    return null;
  }
}

/** Live departures at a rail station or a bus stop. Fetched on open, refreshed every 60 s while open. */
export function StationPage({ id, saved, idle }: { id: string; saved: ReturnType<typeof useSaved>; idle: boolean }) {
  const live = useLive(`/api/station/${id}`, isStationBody, { paused: idle });
  const now = useServerNow(live.data, live.receivedAt);
  const data = live.data;
  const age = data && now !== null ? now - data.checkedAt : null;
  const isBusStop = id.startsWith('490');
  const route = { page: 'station' as const, id };
  const statuses = new Map(savedLines()?.lines.map((l) => [l.lineId, l]));

  return (
    <main className="detail">
      <PageHead title={data?.name ?? (isBusStop ? 'Bus stop' : 'Station')}>
        {data && <SaveButton item={{ route, name: data.name, detail: isBusStop ? 'Bus stop' : undefined }} saved={saved.isSaved(route)} onToggle={saved.toggle} />}
      </PageHead>
      <Updated age={age} stale={!!data?.stale} loading={live.loading} paused={idle} onRefresh={live.reload} />
      <StaleBanner show={!!data?.stale || live.source === 'device'} deviceCopy={live.source === 'device'} age={age ?? 0} error={live.error} />
      {!data && !live.loading && <LoadError error={live.error} onRetry={live.reload} what="departures" />}
      {!data && live.loading && <div className="skeleton skeleton-card" aria-hidden="true" />}
      {data && now !== null && data.lines.length === 0 && <p className="card muted">No services predicted here right now.</p>}
      {data &&
        now !== null &&
        (isBusStop ? (
          <ul className="bus-departures">
            {data.lines.map(({ lineId, lineName, board }) => (
              <BusRow key={lineId} lineId={lineId} name={lineName} board={board} now={now} />
            ))}
          </ul>
        ) : (
          data.lines.map(({ lineId, lineName, board }) => {
            const status = statuses.get(lineId);
            return (
              <section key={lineId} className="card line-card" style={{ borderLeftColor: lineColour(lineId) }} aria-label={lineName}>
                <a className="line-card-head" href={href({ page: 'line', id: lineId })}>
                  <h3>{lineName}</h3>
                  {status && <StatusText tflSays={status.tflSays} severity={status.severity} />}
                  <span className="chevron" aria-hidden="true">
                    ›
                  </span>
                </a>
                <Board board={board} now={now} link={false} />
              </section>
            );
          })
        ))}
    </main>
  );
}

/** One bus route at a stop: "38 · to Victoria · 3 min, 9 min, 14 min". */
function BusRow({ lineId, name, board, now }: { lineId: string; name: string; board: StationBoard; now: number }) {
  const arrivals = board.directions
    .flatMap((d) => d.arrivals)
    .filter((a) => a.at > now - 30_000)
    .sort((a, b) => a.at - b.at);
  const byDest = new Map<string, number[]>();
  for (const a of arrivals) {
    const key = a.terminates ? 'Terminates here' : (a.destination ?? '');
    byDest.set(key, [...(byDest.get(key) ?? []), a.at]);
  }
  return (
    <>
      {[...byDest].map(([dest, times]) => (
        <li key={`${lineId}-${dest}`} className="bus-row">
          <a className="route-badge" href={href({ page: 'bus', id: lineId })}>
            {name}
          </a>
          <span className="bus-dest">{dest ? `to ${dest}` : ''}</span>
          <span className="bus-times">
            {times.slice(0, 3).map((t, i) => (
              <span key={i} className={i === 0 ? 'due' : 'muted'}>
                {formatDue(t, now)}
              </span>
            ))}
          </span>
        </li>
      ))}
    </>
  );
}
