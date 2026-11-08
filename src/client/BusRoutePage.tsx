import { isBusRouteBody } from '../shared/api';
import { useLive, useServerNow } from './live';
import type { useSaved } from './saved';
import { LoadError, PageHead, SaveButton, StatusText, Updated } from './ui';
import { severityFromSays } from './view';

/** One bus route's status, fetched when opened (the all-routes status call is too slow to use). */
export function BusRoutePage({ id, saved, idle }: { id: string; saved: ReturnType<typeof useSaved>; idle: boolean }) {
  const live = useLive(`/api/bus/${id}`, isBusRouteBody, { paused: idle });
  const now = useServerNow(live.data, live.receivedAt);
  const data = live.data;
  const age = data && now !== null ? now - data.checkedAt : null;
  const route = { page: 'bus' as const, id };
  const says = data?.statuses.join(', ') ?? '';

  return (
    <main className="detail">
      <PageHead title={data ? `Bus ${data.name}` : 'Bus route'}>
        {data && <SaveButton item={{ route, name: data.name, detail: 'Bus route' }} saved={saved.isSaved(route)} onToggle={saved.toggle} />}
      </PageHead>
      <Updated age={age} stale={!!data?.stale} loading={live.loading} paused={idle} onRefresh={live.reload} />
      {!data && !live.loading && <LoadError error={live.error} onRetry={live.reload} what="this route" />}
      {!data && live.loading && <div className="skeleton skeleton-card" aria-hidden="true" />}
      {data && (
        <>
          <section className="card">
            <p className="small muted">TfL says</p>
            <StatusText tflSays={says} severity={severityFromSays(says)} big />
            {data.messages.map((m) => (
              <p key={m} className="tfl-message">
                {m}
              </p>
            ))}
          </section>
          <p className="small muted">
            For live times, search your stop by name in the box above. Bus statuses come from TfL and aren't checked
            against live buses.
          </p>
        </>
      )}
    </main>
  );
}
