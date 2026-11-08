import { useState } from 'react';
import { isBusRouteBody, type RouteDirection } from '../shared/api';
import { href, useLive, useServerNow } from './live';
import type { useSaved } from './saved';
import { LoadError, PageHead, SaveButton, StaleBanner, StatusText, Updated } from './ui';
import { formatDue, severityFromSays } from './view';

/**
 * One bus route: TfL's status, then every stop in order with its next buses. Status and times come in one
 * response (one request per minute while open; nothing when closed or idle).
 */
export function BusRoutePage({ id, saved, idle }: { id: string; saved: ReturnType<typeof useSaved>; idle: boolean }) {
  const live = useLive(`/api/bus/${id}`, isBusRouteBody, { paused: idle });
  const now = useServerNow(live.data, live.receivedAt);
  const data = live.data;
  const age = data && now !== null ? now - data.checkedAt : null;
  const route = { page: 'bus' as const, id };
  const says = data?.statuses.join(', ') ?? '';
  const [dir, setDir] = useState(0);
  const direction = data?.directions[Math.min(dir, data.directions.length - 1)];

  return (
    <main className="detail">
      <PageHead title={data ? `Bus ${data.name}` : 'Bus route'}>
        {data && <SaveButton item={{ route, name: data.name, detail: 'Bus route' }} saved={saved.isSaved(route)} onToggle={saved.toggle} />}
      </PageHead>
      <Updated age={age} stale={!!data?.stale} loading={live.loading} paused={idle} onRefresh={live.reload} />
      <StaleBanner show={!!data?.stale || live.source === 'device'} deviceCopy={live.source === 'device'} age={age ?? 0} error={live.error} />
      {!data && !live.loading && <LoadError error={live.error} onRetry={live.reload} what="this route" />}
      {!data && live.loading && <div className="skeleton skeleton-card" aria-hidden="true" />}
      {data && (
        <section className="card">
          <p className="small muted">TfL says</p>
          {says ? <StatusText tflSays={says} severity={severityFromSays(says)} big /> : <p className="muted">Status unavailable right now.</p>}
          {data.messages.map((m) => (
            <p key={m} className="tfl-message">
              {m}
            </p>
          ))}
        </section>
      )}
      {data && now !== null && data.directions.length > 0 && (
        <section aria-label="Next buses at each stop">
          <div className="segmented" role="tablist" aria-label="Direction">
            {data.directions.map((d, i) => (
              <button key={d.id} type="button" role="tab" aria-selected={d === direction} onClick={() => setDir(i)}>
                Towards {d.towards}
              </button>
            ))}
          </div>
          {!data.timesLive && <p className="small muted">Live times unavailable right now; showing stops only.</p>}
          {direction && <Timeline direction={direction} now={now} isSaved={(stop) => saved.isSaved({ page: 'station', id: stop })} />}
        </section>
      )}
    </main>
  );
}

function Timeline({ direction, now, isSaved }: { direction: RouteDirection; now: number; isSaved: (stopId: string) => boolean }) {
  return (
    <ol className="timeline">
      {direction.stops.map((s) => {
        const times = s.arrivals.filter((t) => t > now - 30_000);
        return (
          <li key={s.id}>
            <a href={href({ page: 'station', id: s.id })} className="stop">
              <span className="stop-dot" aria-hidden="true" />
              <span className="stop-name">
                {isSaved(s.id) && <span className="star" aria-label="Saved">★ </span>}
                {s.name}
                {s.letter && <span className="stop-letter">{s.letter}</span>}
              </span>
              <span className="stop-times">
                {times.length === 0 ? (
                  <span className="muted">–</span>
                ) : (
                  times.map((t, i) => (
                    <span key={t} className={i === 0 ? 'due' : 'muted'}>
                      {formatDue(t, now)}
                    </span>
                  ))
                )}
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
