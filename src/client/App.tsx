import { useEffect, useState } from 'react';
import { isHealthBody, type HealthBody } from '../shared/api';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; health: HealthBody }
  | { kind: 'error'; message: string };

/** Phase 0 placeholder: proves the page, the Worker and /api/health are wired together. */
export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        if (!isHealthBody(body)) throw new Error('Unexpected response');
        setState({ kind: 'ok', health: body });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="page">
      <header>
        <h1>Status vs Reality</h1>
        <p className="muted">Is TfL's official status telling the truth right now?</p>
      </header>

      <section className="card" aria-live="polite">
        <h2>Service check</h2>
        {state.kind === 'loading' && <p className="muted">Checking…</p>}
        {state.kind === 'error' && <p className="warn">API unreachable: {state.message}</p>}
        {state.kind === 'ok' && (
          <dl>
            <dt>API</dt>
            <dd>✓ {state.health.status}</dd>
            <dt>TfL key</dt>
            <dd>{state.health.tflKeyConfigured ? '✓ configured' : '✗ not configured'}</dd>
            <dt>Version</dt>
            <dd>{state.health.version}</dd>
            <dt>Server time</dt>
            <dd>{new Date(state.health.serverNow).toLocaleTimeString('en-GB')}</dd>
          </dl>
        )}
      </section>

      <footer className="muted">Powered by TfL Open Data · Line checks coming in the next phases.</footer>
    </main>
  );
}
