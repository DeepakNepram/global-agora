/**
 * src/ui — React components, Tailwind, and anything DOM-aware.
 *
 * This layer may import from src/core, src/globe and src/state.
 * Nothing in src/core or src/globe may import from here (enforced by ESLint
 * and by tests/boundaries.test.ts).
 */
export { App } from './App';
export type { AppProps } from './App';

export {
  detectCapabilities,
  readTierOverride,
  resolveQuality,
  writeTierOverride,
} from './platform/capabilities';
