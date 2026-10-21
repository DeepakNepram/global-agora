import { lazy } from 'react';

/**
 * The dev panel, loaded only in development and in `--mode bench` builds, so
 * benchmarks can run on production React. Behind a dynamic import on
 * purpose: even unused, a static import of it shaped production chunking,
 * splitting the app's start into four files (docs/DECISIONS.md, Prompt 4.5).
 * In a production build the condition is false and the import goes with it.
 */
export const LazyGlobeDevTools =
  import.meta.env.DEV || import.meta.env.MODE === 'bench'
    ? lazy(() => import('./GlobeDevTools').then((m) => ({ default: m.GlobeDevTools })))
    : null;
