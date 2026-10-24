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
7. Search, filters and the library (Prompt 3.4, `src/ui/nav/`,
   `src/ui/library/`). Search runs in the client over the gazetteer
   (`public/data/places.v1.json`, fetched on first use), the payload and the
   outlet index (`GET /api/outlets`). Filters live in the URL and reach the
   pin shader as uniforms. Follows and saves live in localStorage for a
   guest and in Supabase (`follows`, `saved_stories`) once signed in; the SDK
   loads only to resume a stored session, and signing in moves the device's
   lists up (`src/state/library.ts`).
8. Accounts (Prompt 4.1, `src/state/accountController.ts`,
   `src/ui/account/`). Sign-in is Supabase Auth with PKCE: an emailed link
   and 6-digit code, or Google and Apple when configured. A first sign-in
   runs a required setup (17+, a handle, the community rules) through the
   profile functions, and only then moves the library up. Deleting the
   account deletes the auth user, and the cascades take everything else.
9. Discussions (Prompt 4.2; the app's side is step 12). A reader takes one side
   per discussion (`discussion_stances`); votes go straight to Supabase under
   RLS, posts through the API Worker (step 11), and both take that side from
   the record. Vote triggers keep
   the counts, `rank_score` is generated from them, and pg_cron closes
   discussions 48 hours after they open.
10. Moderation (Prompt 4.3). A new post waits, pending, while a trigger
    hands it through pg_net to the `moderate-post` Edge Function
    (`supabase/functions/`), which asks OpenAI and Google and gives both
    replies to `record_moderation()`; the database decides (ok, hidden,
    removed with a strike), suspends at three strikes, and tells the author.
    pg_cron retries what the models did not answer. Readers report and block
    through RLS and `report_post()`; posting limits answer HTTP 429. Admins
    work the queue at `/admin`, a separate chunk loaded instead of the globe.
11. The local badge (Prompt 4.4). The app posts through the API Worker
    (`POST /api/posts`, `workers/api/src/posts.ts`), which inserts as the
    reader with their own token. When the author turns the badge on for that
    post, the Worker adds a label made from `request.cf.city` and `.country`
    alone (`src/core/localBadge.ts`) and a secret the database checks against
    Vault before writing `region_label`. `GET /api/local-badge` tells the
    toggle what it would show. No GPS, no prompt, no coordinates.
12. The discussion (Prompt 4.5, `src/ui/discussion/`). Discuss saves the
    camera's pose and opens the stage (`src/state/discussionStage.ts`): one
    clock that the panel's Web Animation, the camera shot
    (`src/globe/camera/discussionShot.ts`) and the recede effect
    (`src/globe/recede.ts`) all sample. At rest the globe drops to half
    resolution and 30 fps; leaving restores the saved pose exactly. The room
    (`src/state/discussionRoomController.ts`) reads through
    `src/core/db/discussion.ts` under RLS, and posts through the API Worker
    (step 11). A database trigger broadcasts each newly visible post's id on
    a public Realtime topic, and every client reads the post itself, so
    blocks and moderation still apply.
13. The admin console (Prompt 4.6, `/admin`, `src/ui/admin/`, its own
    chunk). Counters, then three tabs: the hot story queue, the moderation
    queue (step 10) and a location correction map. Each admin path is a
    database function that checks `private.is_admin()` first;
    `open_discussion()` enforces the cap on open discussions. The
    `suggest-debate` Edge Function reads the story as the caller and asks
    Claude, over fetch, for a debate prompt and two side labels, which the
    admin edits before opening.
14. The views (Prompt 5.1, `src/ui/NewsView.tsx`). The same stories show on
    the globe, on a flat map under reduced motion (`src/ui/flatmap/`, a 2D
    canvas, no WebGL), or as a list (`src/ui/list/`, from
    `src/core/storyList.ts`). Search, the sheets and Share move whichever
    is showing through one interface, `ViewCamera`
    (`src/ui/nav/viewNavigation.ts`); the map reads altitude as the ground
    scale the globe would show. Tab goes through the visible pins on the
    globe and the map alike (`src/ui/globe/usePinFocus.ts`, over the pin
    layer's `targets()`). See [`ACCESSIBILITY.md`](ACCESSIBILITY.md).

The wire format is defined once, in `src/core/data/payload.ts`, and both the
Worker and the client validate against it.

## Render rules

- One `InstancedMesh` for all pins, cluster orbs included. Never one mesh per pin.
- Pin slots are keyed by story id, never by row.
- Animations are springs the vertex shader evaluates; the CPU writes a
  transition once, not every frame.
- Time is a uniform: scrubbing never rewrites per-pin data.
- Selection is a uniform too: one slot index the shader rings.
- Filters are uniforms as well: a category mask and a window. Only orbs,
  which match through their members, take per-slot data, and only when the
  filter or the layout changes.
- Render on demand: stop the loop when nothing is moving.
- A pin's category is a shape as well as a hue (`src/core/categoryShapes.ts`),
  drawn by signed distance; never colour alone.
- The flat map draws the same layout on a 2D canvas, on demand, through
  the same picking; under reduced motion no WebGL context exists.
- Frame-rate-independent smoothing only — see `src/globe/smoothing.ts`.

## Open questions

- Quality tiers: how to detect a mid-range Android without a benchmark frame.

Resolved: the cluster bloom is instanced, in the pins' own mesh and vertex
shader (DECISIONS, 2026-09-24).
