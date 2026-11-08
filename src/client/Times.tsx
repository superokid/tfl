import type { DirectionBoard } from '../shared/boards';
import { formatDue } from './view';

/** Services not yet gone (up to 30 s after their time). */
export const upcoming = (d: DirectionBoard, now: number) => d.arrivals.filter((a) => a.at > now - 30_000);

/** One platform/direction: label and next services, counting down on the server clock. */
export function Times({ d, now, limit }: { d: DirectionBoard; now: number; limit?: number }) {
  const arrivals = upcoming(d, now).slice(0, limit);
  return (
    <div className="board-dir">
      <p className="board-label small muted">{d.label}</p>
      {arrivals.length === 0 ? (
        <p className="small muted">No services predicted.</p>
      ) : (
        <ol className="times">
          {arrivals.map((a, i) => (
            <li key={`${a.at}-${i}`}>
              <span className="due">{formatDue(a.at, now)}</span>
              <span className={`dest ${a.terminates ? 'muted' : ''}`}>
                {a.terminates ? 'Terminates here' : (a.destination ?? 'Check front of train')}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
