import { useState } from 'react';
import type { StationBoard } from '../../../shared/boards';
import { DISPLAY } from '../../../shared/config';
import { href } from '../../hooks/route';
import { Times, upcoming } from './Times';

export function Board({ board, now, link = true }: { board: StationBoard; now: number; link?: boolean }) {
  const [all, setAll] = useState(false);
  const directions = board.directions.filter((d) => upcoming(d, now).length > 0);
  const more = directions.some((d) => upcoming(d, now).length > DISPLAY.boardRows);
  return (
    <section className="board" aria-label={`Next trains at ${board.name}`}>
      {link && (
        <h4>
          <a href={href({ page: 'station', id: board.stopId })}>{board.name}</a>
        </h4>
      )}
      {!board.live ? (
        <p className="small muted">Live times unavailable right now.</p>
      ) : directions.length === 0 ? (
        <p className="small muted">No services predicted.</p>
      ) : (
        directions.map((d) => <Times key={d.key} d={d} now={now} limit={all ? undefined : DISPLAY.boardRows} />)
      )}
      {more && (
        <button type="button" className="more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Fewer times' : 'More times'}
        </button>
      )}
    </section>
  );
}
