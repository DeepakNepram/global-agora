import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';

import { viewStore } from '@/state';

const BUTTON =
  'h-10 rounded-full px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Shown instead of a white page when rendering fails (Prompt 5.2). */
function CrashScreen(): JSX.Element {
  // The list needs no WebGL, so it is the likeliest view to work.
  const openList = (): void => {
    viewStore.getState().setLayout('list');
    window.location.reload();
  };
  return (
    <main className="flex h-full flex-col items-start justify-center gap-4 bg-void px-6 text-ink">
      <h1 className="text-xl font-semibold" tabIndex={-1} ref={(heading) => heading?.focus()}>
        Something went wrong
      </h1>
      <p className="max-w-prose text-sm text-muted">
        Global Agora hit a problem it could not recover from, and it has been reported. Reloading
        usually fixes it. If the globe keeps failing, the list view shows every story without it.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${BUTTON} bg-accent text-void hover:bg-accent/90`}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
        <button
          type="button"
          className={`${BUTTON} border border-ink/20 text-ink hover:bg-white/10`}
          onClick={openList}
        >
          Open the list view
        </button>
      </div>
    </main>
  );
}

interface State {
  readonly failed: boolean;
}

/**
 * The last line under the whole app. Reporting happens at the root
 * (createRoot's onCaughtError in src/main.tsx), not here, so every boundary
 * reports the same way.
 */
export class AppErrorBoundary extends Component<{ readonly children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(_error: unknown, _info: ErrorInfo): void {
    // Reported by the root's onCaughtError.
  }

  override render(): ReactNode {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}
