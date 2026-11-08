/** Loading placeholders shaped like the content they stand in for, so nothing jumps when data lands. */
import type { CSSProperties, ReactNode } from 'react';

/** One grey bar. `w` is a CSS width; `h` a height (defaults to one line of text). */
export function Bone({ w, h, round, className = '' }: { w?: string; h?: string; round?: boolean; className?: string }) {
  const style: CSSProperties = { width: w, height: h };
  return <span className={`bone${round ? ' bone-round' : ''} ${className}`} style={style} />;
}

/** Announces loading once to screen readers; the bones themselves are hidden from them. */
function Loading({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`sk ${className}`} role="status">
      <span className="visually-hidden">{label}</span>
      <div aria-hidden="true" className="sk-body">
        {children}
      </div>
    </div>
  );
}

// Varied widths read as text, not a grid of identical blocks.
const NAMES = ['42%', '58%', '36%', '50%', '64%', '46%', '54%', '40%'];
const STATUS = ['34%', '28%', '40%', '30%'];

/** Home: the line list. */
export function LinesSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Loading label="Loading line status…">
      <Bone w="9rem" h="1.1rem" className="sk-summary" />
      <ul className="lines">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="line-row sk-row">
            <Bone w={NAMES[i % NAMES.length]} h="1rem" className="line-name" />
            <span className="status sk-status">
              <Bone w="1.15rem" h="1.15rem" round />
              <Bone w={STATUS[i % STATUS.length]} h="0.85rem" />
            </span>
          </li>
        ))}
      </ul>
    </Loading>
  );
}

/** Line page: TfL's status card and the live-check card. */
export function LineSkeleton() {
  return (
    <Loading label="Loading this line…" className="sk-stack">
      <div className="card">
        <Bone w="4.5rem" h="0.8rem" />
        <span className="status sk-status">
          <Bone w="1.5rem" h="1.5rem" round />
          <Bone w="45%" h="1.3rem" />
        </span>
      </div>
      <div className="card check-muted">
        <Bone w="5rem" h="0.8rem" />
        <Bone w="70%" h="1.05rem" />
        <Bone w="90%" />
      </div>
    </Loading>
  );
}

function TimesBones({ rows }: { rows: number }) {
  return (
    <div className="board-dir">
      <Bone w="8rem" h="0.8rem" />
      <ol className="times">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i}>
            <Bone w="2.4rem" />
            <Bone w={NAMES[(i + 2) % NAMES.length]} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Station page: a card per line, each with a platform's next trains. */
export function BoardsSkeleton() {
  return (
    <Loading label="Loading departures…" className="sk-stack">
      {[0, 1].map((i) => (
        <div key={i} className="card line-card sk-line-card">
          <Bone w={NAMES[i + 3]} h="1.05rem" />
          <TimesBones rows={3} />
        </div>
      ))}
    </Loading>
  );
}

function BusRowBones({ i }: { i: number }) {
  return (
    <li className="bus-row">
      <Bone w="2.6rem" h="2rem" className="route-badge sk-badge" />
      <Bone w={NAMES[i % NAMES.length]} className="bus-dest" />
      <span className="bus-times">
        <Bone w="2.2rem" />
        <Bone w="2.2rem" />
        <Bone w="2.2rem" />
      </span>
    </li>
  );
}

/** Bus stop page: one row per route. */
export function BusRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Loading label="Loading departures…">
      <ul className="bus-departures">
        {Array.from({ length: rows }, (_, i) => (
          <BusRowBones key={i} i={i} />
        ))}
      </ul>
    </Loading>
  );
}

/** Bus tab: stops near you, each with a couple of routes. */
export function NearStopsSkeleton() {
  return (
    <Loading label="Finding stops near you…">
      <ul className="near-stops">
        {[0, 1].map((s) => (
          <li key={s} className="card near-stop">
            <div className="near-head">
              <Bone w="2rem" h="2rem" round />
              <span className="near-name sk-lines">
                <Bone w={NAMES[s + 1]} h="1rem" />
                <Bone w="40%" h="0.8rem" />
              </span>
            </div>
            <ul className="bus-departures">
              {[0, 1].map((i) => (
                <BusRowBones key={i} i={s * 2 + i} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Loading>
  );
}

/** Bus route page: status card, direction toggle, then the stop timeline. */
export function RouteSkeleton() {
  return (
    <Loading label="Loading this route…" className="sk-stack">
      <div className="card">
        <Bone w="4.5rem" h="0.8rem" />
        <span className="status sk-status">
          <Bone w="1.5rem" h="1.5rem" round />
          <Bone w="45%" h="1.3rem" />
        </span>
      </div>
      <div className="segmented sk-segmented">
        <Bone h="2.75rem" />
        <Bone h="2.75rem" />
      </div>
      <ul className="timeline">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <div className="stop">
              <Bone w="0.7rem" h="0.7rem" round className="sk-dot" />
              <Bone w={NAMES[i % NAMES.length]} />
              <Bone w="3rem" />
            </div>
          </li>
        ))}
      </ul>
    </Loading>
  );
}
