/** Small shared pieces used by every page. */
import { Component, Fragment, type ReactNode, useEffect } from 'react';
import { Bone } from './Skeletons';
import type { SavedItem } from './saved';
import { formatAge, statusTone, type Tone } from './view';
import type { Expected } from '../shared/rules/types';
import { prettyStatus } from './view';

export function Updated({
  age,
  stale,
  loading,
  paused,
  onRefresh,
}: {
  age: number | null;
  stale: boolean;
  loading: boolean;
  paused: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="updated">
      <p className="small muted" aria-live="polite">
        {age === null ? (
          loading ? 'Loading live data…' : ''
        ) : (
          <>
            <span className={`dot ${stale ? 'dot-warn' : 'dot-live'}`} aria-hidden="true" />
            {stale ? 'Last updated' : 'Live · updated'} {formatAge(age)}
            {paused && ' · paused, tap to refresh'}
          </>
        )}
      </p>
      <button type="button" className="refresh" onClick={onRefresh} disabled={loading} aria-label="Refresh">
        <span aria-hidden="true" className={loading ? 'spin' : ''}>
          ↻
        </span>
      </button>
    </div>
  );
}

export function StaleBanner({ show, deviceCopy, age, error }: { show: boolean; deviceCopy: boolean; age: number; error: string | null }) {
  // A device copy with no error yet is just on screen while the live data loads: the age line says so.
  if (!show || (deviceCopy && !error)) return null;
  return (
    <div className="banner banner-warn" role="status">
      {deviceCopy
        ? `${error ?? "Can't reach the service"}. Showing what this phone last saw, ${formatAge(age)}.`
        : `TfL isn't responding. Showing information from ${formatAge(age)}.`}
    </div>
  );
}

/** Copies of live data kept on this device (not saved items or settings). */
function clearDeviceCopies() {
  try {
    for (const k of Object.keys(localStorage)) if (/^tfl:(lines|line:|station:|bus:)/.test(k)) localStorage.removeItem(k);
  } catch {
    // Storage blocked: nothing to clear.
  }
}

/**
 * Catches a render error so one bad screen never blanks the app. A device copy may be what broke it, so
 * those are dropped; "Try again" then loads fresh from the network.
 */
export class Boundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  override state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.error('render failed:', err);
    clearDeviceCopies();
  }
  override render() {
    if (!this.state.failed) return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    return (
      <div className="card empty" role="alert">
        <p>Something went wrong showing this.</p>
        <button className="button" onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}>
          Try again
        </button>
      </div>
    );
  }
}

export function LoadError({ error, onRetry, what }: { error: string | null; onRetry: () => void; what: string }) {
  return (
    <div className="card empty" role="alert">
      <p>
        Can't load {what} right now{error ? ` (${error})` : ''}.
      </p>
      <button className="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

const TONE_ICON: Record<Tone, string> = { good: '✓', minor: '!', major: '!', closed: '✕', unknown: '?' };

/** TfL's status in plain words, with an icon so colour is never the only signal. */
export function StatusText({ tflSays, severity, big = false }: { tflSays: string; severity: Expected | null; big?: boolean }) {
  const tone = statusTone(severity);
  return (
    <span className={`status status-${tone} ${big ? 'status-big' : ''}`}>
      <span className="status-icon" aria-hidden="true">
        {TONE_ICON[tone]}
      </span>
      {prettyStatus(tflSays)}
    </span>
  );
}

export function SaveButton({ item, saved, onToggle }: { item: SavedItem; saved: boolean; onToggle: (i: SavedItem) => void }) {
  return (
    <button type="button" className={`save ${saved ? 'save-on' : ''}`} onClick={() => onToggle(item)} aria-pressed={saved}>
      <span aria-hidden="true">{saved ? '★' : '☆'}</span> {saved ? 'Saved' : 'Save'}
    </button>
  );
}

/** Browser tab and history title, so screen readers and the back list name the page. */
export function useTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · London Live` : 'London Live';
  }, [title]);
}

export function PageHead({
  colour,
  title,
  sub,
  pending = false,
  children,
}: {
  colour?: string;
  title: string;
  sub?: ReactNode;
  /** The real name is still loading: show a bone, not a generic placeholder title. */
  pending?: boolean;
  children?: ReactNode;
}) {
  useTitle(pending ? null : title);
  return (
    <div className={`page-head${colour ? ' coloured' : ''}`} style={colour ? { borderLeftColor: colour } : undefined}>
      <a href="#" className="back">
        ← Home
      </a>
      <div className="page-title">
        <div className="page-name">
          <h2>
            {pending ? (
              <>
                <Bone />
                <span className="visually-hidden">{title}</span>
              </>
            ) : (
              title
            )}
          </h2>
          {sub && <p className="page-sub">{sub}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
