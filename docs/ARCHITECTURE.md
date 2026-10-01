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

## Data flow

```
GDELT GKG ──15 min──> ingest Worker ──service key──> Supabase
                                                        │ api_nodes / api_story
                                                        │ (publishable key, RLS)
browser <──Brotli, ETag, SWR── API Worker <─────────────┘
```

1. The ingest Worker (`workers/ingest/`, Prompt 2.2) reads each 15-minute
   GDELT GKG file, de-duplicates it into stories, scores heat and writes them
   through one transactional RPC. Workers may import `src/core` only, and
   `src/` never imports `workers/` (ESLint plus `tests/boundaries.test.ts`).
2. The API Worker (`workers/api/`, Prompt 2.3) serves one columnar payload
   for the whole window (`GET /api/nodes`), about 131 KB with Brotli for 3000
   stories, and one story in full on tap (`GET /api/story/:id`). It caches at
   the edge with stale-while-revalidate and holds only the publishable key.
3. The client (`src/core/data/`) decodes the payload straight into a
   `NodeBuffer` of typed arrays and re-checks it every two minutes; an
   unchanged payload is a 304. The pin layer draws the buffer as it is.
4. A Web Worker clusters the buffer with supercluster (`src/core/cluster/`,
   Prompt 3.1). The pin scene asks it for the layout at the camera's zoom
   level, and the pin layer animates each change on the GPU: orbs bloom into
   their children, and stacked stories into a sunflower.
5. The time scrubber (`src/ui/scrubber/`, Prompt 3.2) writes only the time
   store, with no network calls. The sun and the pins read it as uniforms:
   the pin shader ages every story against `uNow`, so visibility and
   brightness follow the scrubbed instant. While a drag or Play moves the
   time, the clusters open into pins and fold back when it rests.
6. A tap is picked on the CPU against the last layout
   (`src/globe/pins/pinPick.ts`, Prompt 3.3) and opens the story sheet
   (`src/ui/story/`). The card fills at once from the payload, then from
   `GET /api/story/:id`, revalidated on every ask. Share copies a permalink
   (`src/core/permalink.ts`) of the camera, the instant and the story, and a
   page opened with one starts on that view.

The wire format is defined once, in `src/core/data/payload.ts`, and both the
Worker and the client validate against it.

## Render rules

- One `InstancedMesh` for all pins, cluster orbs included. Never one mesh per pin.
- Pin slots are keyed by story id, never by row.
- Animations are springs the vertex shader evaluates; the CPU writes a
  transition once, not every frame.
- Time is a uniform: scrubbing never rewrites per-pin data.
- Selection is a uniform too: one slot index the shader rings.
- Render on demand: stop the loop when nothing is moving.
- Frame-rate-independent smoothing only — see `src/globe/smoothing.ts`.

## Open questions

- Quality tiers: how to detect a mid-range Android without a benchmark frame.

Resolved: the cluster bloom is instanced, in the pins' own mesh and vertex
shader (DECISIONS, 2026-09-24).
