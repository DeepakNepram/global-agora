/**
 * src/globe — the Three.js render layer.
 *
 * Three.js and the r3f wrapper only. No DOM chrome, no Supabase, no state store,
 * and never an import from src/ui — data comes in as arguments. Enforced by
 * ESLint (@typescript-eslint/no-restricted-imports) and tests/boundaries.test.ts.
 *
 * Phase 1 adds: sphere + day/night textures, terminator shader, atmosphere,
 * camera with inertia, and a single InstancedMesh for every pin.
 */
export { smoothTowards } from './smoothing';
