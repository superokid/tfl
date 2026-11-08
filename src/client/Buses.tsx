import { useCallback, useEffect, useState } from 'react';
import { type BusTimes, isNearbyBody, type NearbyStop } from '../shared/api';
import { DISPLAY, NEARBY } from '../shared/config';
import { href, useLive, useServerNow } from './live';
import type { SavedItem } from './saved';
import { Updated } from './ui';
import { formatDue } from './view';

/** "38 · to Victoria · 2 min, 9 min, 14 min": one route and destination at a stop. */
export function BusTimesRow({ row, now }: { row: BusTimes; now: number }) {
  return (
    <li className="bus-row">
      <a className="route-badge" href={href({ page: 'bus', id: row.routeId })}>
        {row.routeName}
      </a>
      <span className="bus-dest">{row.destination ? (row.destination === 'Terminates here' ? row.destination : `to ${row.destination}`) : ''}</span>
      <span className="bus-times">
        {row.times.map((t, i) => (
          <span key={t} className={i === 0 ? 'due' : 'muted'}>
            {formatDue(t, now)}
          </span>
        ))}
      </span>
    </li>
  );
}

/** Where the passenger is, rounded to a ~100 m cell on the phone: the exact position never leaves it. */
type Where = { state: 'off' | 'locating' | 'denied' | 'failed' | 'outside' } | { state: 'at'; lat: string; lon: string };

function useWhere(): [Where, () => void] {
  const [where, setWhere] = useState<Where>({ state: 'off' });
  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) return setWhere({ state: 'failed' });
    setWhere({ state: 'locating' });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const b = NEARBY.bounds;
        const inLondon = coords.latitude >= b.south && coords.latitude <= b.north && coords.longitude >= b.west && coords.longitude <= b.east;
        setWhere(
          inLondon
            ? { state: 'at', lat: coords.latitude.toFixed(NEARBY.coordDecimals), lon: coords.longitude.toFixed(NEARBY.coordDecimals) }
            : { state: 'outside' },
        );
      },
      (err) => setWhere({ state: err.code === err.PERMISSION_DENIED ? 'denied' : 'failed' }),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }, []);
  // Already allowed on an earlier visit: find stops straight away, without a prompt.
  useEffect(() => {
    let live = true;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => live && p.state === 'granted' && locate())
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [locate]);
  return [where, locate];
}

const NOTES: Record<Exclude<Where['state'], 'at'>, string> = {
  off: 'See the next buses at the stops around you. Your location is rounded to about 100 m and never stored.',
  locating: 'Finding where you are…',
  denied: 'Location is turned off for this site. Search for your stop by name at the top instead.',
  failed: "Couldn't get your location. Try again, or search for your stop at the top.",
  outside: 'You seem to be outside London. Search for a stop by name at the top.',
};

function NearYou({ idle }: { idle: boolean }) {
  const [where, locate] = useWhere();
  const url = where.state === 'at' ? `/api/nearby?lat=${where.lat}&lon=${where.lon}` : null;
  const live = useLive(url, isNearbyBody, { paused: idle });
  const now = useServerNow(live.data, live.receivedAt);
  const data = url ? live.data : null;
  const age = data && now !== null ? now - data.checkedAt : null;

  return (
    <section className="near" aria-label="Bus stops near you">
      <div className="near-top">
        <h2>Near you</h2>
        <button type="button" className="button" onClick={locate} disabled={where.state === 'locating'}>
          {where.state === 'at' ? 'Update location' : 'Use my location'}
        </button>
      </div>
      {where.state !== 'at' ? (
        <p className="small muted">{NOTES[where.state]}</p>
      ) : (
        <>
          <Updated age={age} stale={!!data?.stale} loading={live.loading} paused={idle} onRefresh={live.reload} />
          {!data && live.loading && <div className="skeleton skeleton-card" aria-hidden="true" />}
          {!data && !live.loading && <p className="small muted">Couldn't load nearby stops right now. Try again in a minute.</p>}
          {data && data.stops.length === 0 && <p className="small muted">No bus stops within {NEARBY.radiusM} m.</p>}
          {data && now !== null && (
            <ul className="near-stops">
              {data.stops.map((s) => (
                <NearStop key={s.id} stop={s} now={now} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function NearStop({ stop, now }: { stop: NearbyStop; now: number }) {
  const rows = stop.buses.filter((r) => r.times.some((t) => t > now - 30_000));
  const more = rows.length - DISPLAY.nearbyRowsPerStop;
  const to = href({ page: 'station', id: stop.id });
  return (
    <li className="card near-stop">
      <a className="near-head" href={to}>
        {stop.letter && /^[A-Z0-9]{1,3}$/.test(stop.letter) && <span className="stop-flag">{stop.letter}</span>}
        <span className="near-name">
          <strong>{stop.name}</strong>
          <span className="small muted">
            {stop.towards ? `towards ${stop.towards} · ` : ''}
            {stop.distanceM} m
          </span>
        </span>
        <span className="chevron" aria-hidden="true">
          ›
        </span>
      </a>
      {!stop.live && rows.length === 0 ? (
        <p className="small muted">Live times unavailable right now.</p>
      ) : rows.length === 0 ? (
        <p className="small muted">No buses due in the next half hour.</p>
      ) : (
        <ul className="bus-departures">
          {rows.slice(0, DISPLAY.nearbyRowsPerStop).map((r) => (
            <BusTimesRow key={`${r.routeId}-${r.destination}`} row={r} now={now} />
          ))}
        </ul>
      )}
      {more > 0 && (
        <a className="small near-more" href={to}>
          +{more} more at this stop
        </a>
      )}
    </li>
  );
}

/** Buses, stop first: saved stops and routes, then the stops near me. Search is the box at the top. */
export function BusTab({ saved, idle }: { saved: SavedItem[]; idle: boolean }) {
  const savedBus = saved.filter((s) => s.route.page === 'bus' || (s.route.page === 'station' && s.route.id.startsWith('490')));

  return (
    <section className="bus-tab" aria-label="Buses">
      {savedBus.length > 0 && (
        <ul className="lines" aria-label="Saved stops and routes">
          {savedBus.map((s) => (
            <li key={s.route.id}>
              <a className="line-row" href={href(s.route)}>
                <span className="line-name">{s.route.page === 'bus' ? `Route ${s.name}` : s.name}</span>
                <span className="small muted">{s.detail ?? (s.route.page === 'bus' ? 'Bus route' : 'Bus stop')}</span>
                <span className="chevron" aria-hidden="true">
                  ›
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {savedBus.length === 0 && <p className="small muted">Search a stop or route number at the top, then ☆ Save it to see it here.</p>}

      <NearYou idle={idle} />
    </section>
  );
}
