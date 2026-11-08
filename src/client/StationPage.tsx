import { isLinesBody, isStationBody, type LinesBody } from '../shared/api';
import { busRows } from '../shared/boards';
import { BusTimesRow } from './Buses';
import { lineColour } from './lineColours';
import { href, useLive, useServerNow } from './live';
import type { useSaved } from './saved';
import { Board } from './LinePage';
import { BoardsSkeleton, BusRowsSkeleton } from './Skeletons';
import { LoadError, PageHead, SaveButton, StaleBanner, StatusText, Updated } from './ui';
import { stopDetail } from './view';

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
  const live = useLive(`/api/station/${id}`, isStationBody, { paused: idle, saveAs: `tfl:station:${id}` });
  const now = useServerNow(live.data, live.receivedAt);
  const data = live.data;
  const age = data && now !== null ? now - data.checkedAt : null;
  const isBusStop = id.startsWith('490');
  const route = { page: 'station' as const, id };
  const statuses = new Map(savedLines()?.lines.map((l) => [l.lineId, l]));

  return (
    <main className="detail">
      <PageHead
        title={data?.name ?? (isBusStop ? 'Bus stop' : 'Station')}
        pending={!data && live.loading}
        sub={
          isBusStop &&
          data &&
          (data.letter || data.towards) && (
            <>
              {data.letter && <span className="stop-flag">{data.letter}</span>}
              {data.towards ? `towards ${data.towards}` : `Stop ${data.letter}`}
            </>
          )
        }
      >
        {data && (
          <SaveButton
            item={{ route, name: data.name, detail: isBusStop ? stopDetail(data.letter, data.towards) : undefined }}
            saved={saved.isSaved(route)}
            onToggle={saved.toggle}
          />
        )}
      </PageHead>
      <Updated age={age} stale={!!data?.stale || live.source === 'device'} loading={live.loading} paused={idle} onRefresh={live.reload} />
      <StaleBanner show={!!data?.stale || live.source === 'device'} deviceCopy={live.source === 'device'} age={age ?? 0} error={live.error} />
      {!data && !live.loading && <LoadError error={live.error} onRetry={live.reload} what="departures" />}
      {!data && live.loading && (isBusStop ? <BusRowsSkeleton /> : <BoardsSkeleton />)}
      {data && now !== null && data.lines.length === 0 && <p className="card muted">No services predicted here right now.</p>}
      {data &&
        now !== null &&
        (isBusStop ? (
          <ul className="bus-departures">
            {busRows(data.lines, now).map((r) => (
              <BusTimesRow key={`${r.routeId}-${r.destination}`} row={r} now={now} />
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
