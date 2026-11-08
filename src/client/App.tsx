import { BusRoutePage } from './BusRoutePage';
import { Home } from './Home';
import { LinePage } from './LinePage';
import { useIdle, useRoute } from './live';
import { useSaved } from './saved';
import { Search } from './Search';
import { StationPage } from './StationPage';

/**
 * Passenger-first layout: one search box (stations, bus stops, routes), saved favourites, and per-mode
 * status. Every screen fetches only its own data, when it's opened (ADR-011).
 */
export function App() {
  const route = useRoute();
  const idle = useIdle();
  const saved = useSaved();

  return (
    <div className="page">
      <header className="top">
        <a href="#" className="brand">
          <h1>London Live</h1>
          <p className="small muted">TfL status, checked against live trains</p>
        </a>
      </header>

      <Search />

      {route.page === 'home' && <Home saved={saved.items} idle={idle} />}
      {route.page === 'line' && <LinePage key={route.id} id={route.id} saved={saved} idle={idle} />}
      {route.page === 'station' && <StationPage key={route.id} id={route.id} saved={saved} idle={idle} />}
      {route.page === 'bus' && <BusRoutePage key={route.id} id={route.id} saved={saved} idle={idle} />}

      <footer className="small muted">
        <p>
          Line statuses come from TfL. For rail, we also compare them with live arrival predictions at two
          stations per line, and flag a line only when both stations agree.
        </p>
        <p>Powered by TfL Open Data. Not affiliated with TfL.</p>
      </footer>
    </div>
  );
}
