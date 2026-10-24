import { Component, type ReactNode } from 'react';

import { globeHealthStore } from '@/state';

interface State {
  readonly failed: boolean;
}

/**
 * Around the 3D globe (Prompt 5.2): if its rendering throws, the flat map
 * takes its place instead of the page going blank. React Three Fiber passes
 * errors in the scene up to here. Reported by the root's onCaughtError.
 */
export class GlobeErrorBoundary extends Component<{ readonly children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(): void {
    globeHealthStore.getState().crashed();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
