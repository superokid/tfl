import { useCallback, useEffect, useRef, useState } from 'react';
import { NEARBY } from '../shared/config';

/** Where the passenger is, rounded to a ~100 m cell on the phone. */
export type Where = { state: 'off' | 'locating' | 'denied' | 'failed' | 'outside' } | { state: 'at'; lat: string; lon: string };

type Bounds = { south: number; north: number; west: number; east: number };

/**
 * The phone's position, on request. `bounds`: outside them it's 'outside'. `auto`: locate at once if the
 * browser already allows it (no prompt). `clear` goes back to 'off' and ignores a fix still on its way.
 */
export function useWhere({ bounds, auto }: { bounds: Bounds | null; auto: boolean }): [Where, () => void, () => void] {
  const [where, setWhere] = useState<Where>({ state: 'off' });
  const req = useRef(0);
  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) return setWhere({ state: 'failed' });
    const n = ++req.current;
    setWhere({ state: 'locating' });
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude: lat, longitude: lon } }) => {
        if (n !== req.current) return;
        const inside = !bounds || (lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east);
        setWhere(inside ? { state: 'at', lat: lat.toFixed(NEARBY.coordDecimals), lon: lon.toFixed(NEARBY.coordDecimals) } : { state: 'outside' });
      },
      (err) => n === req.current && setWhere({ state: err.code === err.PERMISSION_DENIED ? 'denied' : 'failed' }),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }, [bounds]);
  const clear = useCallback(() => {
    req.current++;
    setWhere({ state: 'off' });
  }, []);
  useEffect(() => {
    if (!auto) return;
    let live = true;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => live && p.state === 'granted' && locate())
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [auto, locate]);
  return [where, locate, clear];
}
