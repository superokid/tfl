import { useId, useMemo, useState } from 'react';
import { lineColour } from './lineColours';
import { useStationIndex } from './stations';
import { searchStations } from './view';

/** Search any rail station. The index loads on first focus; typing never calls TfL. */
export function StationSearch({ onPick }: { onPick: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(false);
  const stations = useStationIndex(active);
  const results = useMemo(() => (stations ? searchStations(stations, query) : []), [stations, query]);
  const listId = useId();

  const pick = (id: string) => {
    setQuery('');
    onPick(id);
  };

  return (
    <div className="search" role="search">
      <label htmlFor={`${listId}-input`} className="visually-hidden">
        Search for a station
      </label>
      <input
        id={`${listId}-input`}
        type="search"
        placeholder="Search a station for live departures"
        autoComplete="off"
        value={query}
        onFocus={() => setActive(true)}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) pick(results[0].id);
        }}
        aria-controls={query.trim() ? listId : undefined}
      />
      {query.trim() && (
        <ul id={listId} className="results" aria-live="polite">
          {!stations ? (
            <li className="muted small">Loading stations…</li>
          ) : results.length === 0 ? (
            <li className="muted small">No station matches "{query.trim()}".</li>
          ) : (
            results.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => pick(s.id)}>
                  <span>{s.name}</span>
                  <span className="dots" aria-hidden="true">
                    {s.lines.map((l) => (
                      <span key={l} className="dot-line" style={{ background: lineColour(l) }} />
                    ))}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
