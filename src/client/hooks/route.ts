/** Hash routing: `#line/<id>`, `#station/<id>`, `#bus/<id>`; anything else is home. */
import { useEffect, useState } from 'react';

export type Route =
  | { page: 'home' }
  | { page: 'line'; id: string }
  | { page: 'station'; id: string }
  | { page: 'bus'; id: string };

export function parseRoute(hash: string): Route {
  const m = /^#(line|station|bus)\/([A-Za-z0-9-]{1,30})$/.exec(hash);
  return m ? ({ page: m[1], id: m[2] } as Route) : { page: 'home' };
}

export const href = (r: Route) => (r.page === 'home' ? '#' : `#${r.page}/${r.id}`);

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
