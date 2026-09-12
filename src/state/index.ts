/**
 * src/state — Zustand stores.
 *
 * Empty until Phase 1. Zustand is deliberately not installed yet: there is no
 * store to hold. `npm i zustand` when the camera/scrubber state lands.
 *
 * Stores own plain data only. Keep Three.js objects out of them — mutating a
 * store every frame triggers React re-render storms and breaks render-on-demand.
 */
export {};
