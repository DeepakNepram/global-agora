# Architecture

> Stub. Filled in as each phase lands. Source of truth for the product plan is
> [`../news-globe-build-plan.md`](../news-globe-build-plan.md); source of truth for
> the rules is [`../CLAUDE.md`](../CLAUDE.md).

## Layers

```
src/globe/   Three.js render layer. Pure. No React, no DOM chrome, no Supabase.
src/core/    Models, types, data fetching, geo math. Framework-agnostic, no DOM.
src/ui/      React + Tailwind. May import from core, globe and state.
src/state/   Zustand stores. Plain data only.
workers/     Cloudflare Workers: cron ingest, API edge. Holds every service key.
supabase/    Migrations, RLS policies, edge functions.
```

**The one rule that cannot bend:** `src/globe/` and `src/core/` never import from
`src/ui/`. That is what turns the eventual native port into a port rather than a
rewrite. It is enforced twice — by ESLint (`eslint.config.js`) and by
[`../tests/boundaries.test.ts`](../tests/boundaries.test.ts), so silencing the
linter is not enough to cross it.

Dependency direction:

```
ui ──> state ──> core
 └───> globe ──> core
```

## Data flow (target, Phase 3)

1. Worker cron pulls GDELT every 15 min, dedupes, scores heat, writes `stories`.
2. Worker serves one compact columnar payload for the whole 24h window,
   edge-cached. Under 150KB compressed.
3. Client loads it once into typed arrays. The time scrubber is then pure
   client-side filtering — zero network calls, which is why it feels instant.
4. Scrubbing updates pin visibility, pin brightness and sun position together.

## Render rules

- One `InstancedMesh` for all pins. Never one mesh per pin.
- Render on demand: stop the loop when nothing is moving.
- Frame-rate-independent smoothing only — see `src/globe/smoothing.ts`.

## Open questions

- Quality tiers: how to detect a mid-range Android without a benchmark frame.
- Cluster bloom animation: instanced or a second pass?
