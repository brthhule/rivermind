import { Component, type ErrorInfo, type ReactNode } from 'react';

const RELOAD_KEY = 'rivermind:chunk-reload';

/** A failed lazy import usually means the site was redeployed while this tab was open. */
const isChunkError = (e: unknown) => e instanceof Error && /dynamically imported module|Failed to fetch|Importing a module script failed|error loading dynamically/i.test(e.message);

/**
 * Catches render errors in one page so a bug shows a recoverable message instead of a blank screen.
 * The `resetKey` (the current route) clears the error when the user navigates elsewhere.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) { return { error }; }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Rivermind page error', error, info.componentStack);
    // New deploy while the tab was open: reload once to pick up the new files.
    if (isChunkError(error)) {
      let tried = false;
      try { tried = sessionStorage.getItem(RELOAD_KEY) === '1'; sessionStorage.setItem(RELOAD_KEY, '1'); } catch { /* ignore */ }
      if (!tried) window.location.reload();
    }
  }

  componentDidMount() {
    try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* ignore */ }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    return (
      <div className="panel col crash">
        <h2 style={{ margin: 0 }}>{chunk ? 'Rivermind was updated' : 'This page hit a problem'}</h2>
        <p className="muted">
          {chunk
            ? 'A newer version of the site was published while this tab was open. Reload to get it.'
            : 'Your data is safe: it is stored separately and was not changed. Try the page again, or reload the site.'}
        </p>
        <div className="row">
          {!chunk && <button onClick={() => this.setState({ error: null })}>Try again</button>}
          <button className="primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
        {!chunk && <details><summary className="small muted">Technical details</summary><pre>{error.message}</pre></details>}
      </div>
    );
  }
}
