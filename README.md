# Global Agora

Browse the world's news on a cinematic 3D globe, scrub back through the last 24
hours to watch a story spread, and debate hot stories in structured, sided
discussions.

Web first. Native mobile is a later phase, so the code stays portable — see
[the boundary](#the-boundary-that-matters).

**Status: Phase 5 in progress.** The globe shows real news from GDELT:
ingested every 15 minutes, grouped into stories, served as one compact
payload, clustered in a Web Worker, and opened with an animated bloom as you
zoom in. A time scrubber drags or plays back through the last 24 hours, with
the pins and the day/night line moving together. Tapping a pin opens its
story: a peek card, a full sheet of every outlet's coverage, Save, and Share
links that reopen the same view. Search finds places, topics, stories and
outlets; filters dim what they leave out; a Following tab and a Saved list
keep what you care about, on your device or in your account. Signing in (an
emailed link or code; Google and Apple once set up) asks once for 17+, a
handle and the community rules, and an account can be deleted from the
account sheet in three taps. Reading never needs one. Hot stories open
sided discussions from an admin console, with moderation, and a coarse
local badge when a reader chooses it. Everything works without the globe:
a list view, a flat map under reduced motion, the globe's pins by Tab, and
WCAG AA colour, checked by axe-core in CI ([accessibility](docs/ACCESSIBILITY.md)).

## Requirements

- Node **>= 22.12** (Vite 8 requires `^20.19 || >=22.12`)
- npm 10+

## Setup

```bash
npm install
cp .env.example .env.local   # PowerShell: Copy-Item .env.example .env.local
npm run dev
```

`.env.local` can stay blank: `src/core/config.ts` falls back to free-tier
defaults. Open http://localhost:5173. The pins come from the API Worker; see
[API](#api) to run it locally, or pick a mock load in the dev panel.

Textures are **not** in the repo. Before Phase 1 you will also need:

```bash
npm run textures
```

## Scripts

| Script                     | What it does                                      |
| -------------------------- | ------------------------------------------------- |
| `npm run dev`              | Vite dev server with HMR                          |
| `npm run build`            | Typecheck, then production build to `dist/`       |
| `npm run preview`          | Serve the built bundle                            |
| `npm run typecheck`        | `tsc --noEmit`                                    |
| `npm run lint`             | ESLint, including the layer-boundary rules        |
| `npm run lint:fix`         | ESLint with `--fix`                               |
| `npm run format`           | Prettier write                                    |
| `npm run format:check`     | Prettier check (what CI runs)                     |
| `npm run test`             | Vitest, once                                      |
| `npm run test:watch`       | Vitest, watching                                  |
| `npm run verify`           | typecheck + lint + format:check + test, in one go |
| `npm run test:e2e`         | axe-core and keyboard checks in Chromium (below)  |
| `npm run test:e2e:build`   | The production build those checks run against     |
| `npm run textures`         | fetch + build the Earth textures (see below)      |
| `npm run db:start`         | Start local Supabase in Docker (see Database)     |
| `npm run db:reset`         | Re-apply every migration, then the seed           |
| `npm run db:test`          | pgTAP tests: RLS, grants, constraints             |
| `npm run db:smoke`         | Query back through the anon key, as the app will  |
| `npm run db:types`         | Regenerate `src/core/db/types.ts` from the schema |
| `npm run db:seed:generate` | Regenerate `supabase/seed.sql`                    |
| `npm run db:stop`          | Stop local Supabase                               |
| `npm run ingest:dev`       | Run the ingest Worker locally (see Ingest)        |
| `npm run ingest:replay`    | Replay real GDELT slots in memory, print stats    |
| `npm run ingest:data`      | Regenerate the FIPS and outlet-country tables     |
| `npm run api:dev`          | Run the API Worker locally on :8788 (see API)     |
| `npm run api:measure`      | Payload size, column costs and latency, live      |

## Database

Supabase runs locally in Docker; no account or credentials are needed.
Docker Desktop must be running.

```bash
npm run db:start   # first run downloads about 1 GB of images
npm run db:reset   # migrations + 200 fictional seed stories from the last 24 h
npm run db:test    # 632 pgTAP assertions: RLS, constraints, ingest, API, accounts, discussions,
                   # moderation, the local badge, the live feed, the admin console
npm run db:smoke   # the stories come back, other tables refuse, an account's life, a discussion,
                   # known-toxic posts through the moderation pipeline, the local badge
                   # through the API Worker, a live post over Realtime, the admin console
                   # with its debate suggestions
```

Discussions update live through Realtime, which the local stack runs
(`supabase/config.toml`). A stack started before Prompt 4.5 needs a restart:
`npm run db:stop && npm run db:start`.

Sign-in emails never leave the machine: the local stack catches them in
Mailpit at http://127.0.0.1:54324, link and code included.

Moderation runs in a Supabase Edge Function, served by the local stack. Copy
`supabase/functions/.env.example` to `supabase/functions/.env` and restart the
stack (`npm run db:stop && npm run db:start`). With no model keys there,
db:smoke stands in for the models with recorded replies; put an OpenAI key
(and a Google Cloud key) there to run the known-toxic posts live, and
`npm run db:smoke -- --record` to save the live replies.

Admins are added by SQL (`insert into public.admins (user_id) select id from
public.profiles where handle = '…'`). They sign in on the globe, then work
the admin console at `/admin`: the counters, the hot story queue
(`/admin`), the moderation queue (`/admin/moderation`) and the location map
(`/admin/locations`).

Opening a discussion asks Claude for a suggested prompt and two sides,
through the `suggest-debate` Edge Function. Locally that needs
`ANTHROPIC_API_KEY` in `supabase/functions/.env` (you add it; never paste
it anywhere else) and a stack restart. Without a key the function asks
db:smoke's stand-in (`DEBATE_STAND_IN_URL`), which answers only while
db:smoke runs. Otherwise the form says Claude did not answer, and you type
the words.

**HTTPS-scanning antivirus** (Avast's Web Shield, for one) re-signs TLS
with a root that Windows trusts but Docker containers don't. Local Edge
Functions then cannot reach OpenAI, Google or Anthropic: add exceptions
for those hosts to run them live. Hosted functions are not affected.

The schema and the access matrix are in
[`docs/DATA_SCHEMA.md`](docs/DATA_SCHEMA.md). After changing a migration, run
`npm run db:reset` and then `npm run db:types`. CI fails if the types are stale.

To put the schema on a hosted project, run these yourself, since they need your
login and database password:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

`db push` leaves the fictional seed out unless you pass `--include-seed`.

The live feed uses public Realtime channels. Keep Realtime's "Allow public
access" on (Project Settings → Realtime; it is on by default), or
discussions stop updating live.

The two Edge Functions deploy on their own. Set their secrets in the
dashboard (Project Settings → Edge Functions → Secrets), never the local
values in `supabase/functions/.env`: `OPENAI_API_KEY`, `GOOGLE_API_KEY`,
`MODERATION_HOOK_SECRET` (a new random value) and `ANTHROPIC_API_KEY`.
Then:

```bash
npx supabase functions deploy moderate-post
```

```bash
npx supabase functions deploy suggest-debate
```

## Ingest

`workers/ingest/` is a Cloudflare Worker that reads GDELT's 15-minute GKG file,
groups articles into stories, scores heat, and writes them to Supabase. How it
works and why: [`docs/DECISIONS.md`](docs/DECISIONS.md) (the heat formula is
there) and [`docs/DATA_SCHEMA.md`](docs/DATA_SCHEMA.md).

Run it locally against local Supabase (`npm run db:start` first):

```bash
cp workers/ingest/.dev.vars.example workers/ingest/.dev.vars
```

Fill in `.dev.vars` (gitignored):

- `SUPABASE_SERVICE_ROLE_KEY`: the `SECRET_KEY` from `npx supabase status`;
- `INGEST_TRIGGER_SECRET`: any string of 32 or more characters.

Then:

```bash
npm run ingest:dev
```

Trigger a run on demand, from a second terminal:

```bash
curl -X POST -H "Authorization: Bearer $INGEST_TRIGGER_SECRET" http://127.0.0.1:8787/run
```

Options on `/run`:

- `?slot=20260924084500` processes one slot;
- `?dry=1` computes everything and writes nothing.

The JSON reply lists each slot with its counts and hottest stories.
`http://127.0.0.1:8787/__scheduled` fires the cron path.

To try heat or queue settings without a database:

```bash
npm run ingest:replay -- --slots 16 --saturation 49,15,30 --queue-heat 215
```

**Deploying needs the Workers Paid plan.** A slot takes 80–280 ms of CPU, and
the free plan allows 10 ms per cron run. Push the migration, set the three
secrets, and deploy. The `wrangler` commands prompt for each value, so none
end up in your shell history or in chat:

```bash
npx supabase db push
npx wrangler secret put SUPABASE_URL -c workers/ingest/wrangler.jsonc
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY -c workers/ingest/wrangler.jsonc
npx wrangler secret put INGEST_TRIGGER_SECRET -c workers/ingest/wrangler.jsonc
npx wrangler deploy -c workers/ingest/wrangler.jsonc
```

Logs are one JSON line per step (Workers Logs is enabled in `wrangler.jsonc`).

## API

`workers/api/` serves the globe: `GET /api/nodes?hours=24`, the columnar
payload, and `GET /api/story/:id`, one story in full. It reads with the
**publishable** key only. Format and headers:
[`docs/DATA_SCHEMA.md`](docs/DATA_SCHEMA.md); why it is built this way:
[`docs/DECISIONS.md`](docs/DECISIONS.md).

Run it locally against local Supabase:

```bash
cp workers/api/.dev.vars.example workers/api/.dev.vars
```

Set `SUPABASE_ANON_KEY` in `.dev.vars` to the `PUBLISHABLE_KEY` from
`npx supabase status`; `REGION_LABEL_SECRET` already matches the local seed.
Then run the Worker and the app side by side; Vite proxies `/api` to it:

```bash
npm run api:dev
```

```bash
npm run dev
```

`api:dev` runs on a stand-in network in Bengaluru (`workers/api/dev/`), never
your own: wrangler would otherwise hand the Worker your real city. For a
network with no city, as the local badge's disabled state needs:

```bash
npm run api:dev -- --no-city
```

Measure the payload from a second terminal. For a cold build, stop
`api:dev`, delete `workers/api/.wrangler/state` (wrangler keeps its local edge
cache between restarts) and start it again first:

```bash
npm run api:measure
```

**Deploying:** set the two values (the key is publishable, not secret, but
`secret put` keeps it out of the repo) and deploy. The edge cache (the Cache
API) does nothing on `*.workers.dev`, so give the Worker a route on your own
domain beside the Pages app; `wrangler.jsonc` shows the shape.

```bash
npx supabase db push
npx wrangler secret put SUPABASE_URL -c workers/api/wrangler.jsonc
npx wrangler secret put SUPABASE_ANON_KEY -c workers/api/wrangler.jsonc
npx wrangler secret put REGION_LABEL_SECRET -c workers/api/wrangler.jsonc
npx wrangler deploy -c workers/api/wrangler.jsonc
```

`REGION_LABEL_SECRET` is a new random value (never the local
`local-only-region-label`) that lets a post carry its local badge. Put the
same value in the database's Vault, in the SQL editor:
`select vault.create_secret('<the same value>', 'region_label_secret');`.

## Layout

```
src/globe/   Three.js only. No React, no DOM, no Supabase. Pure render layer.
src/core/    Models, types, data fetching, geo math. Framework-agnostic, no DOM.
src/ui/      React components. Tailwind. Talks to core/ and globe/.
src/state/   Zustand stores.
workers/     Cloudflare Workers: ingest/ (cron), api/ (payload), shared/.
supabase/    Migrations, RLS policies, edge functions.
docs/        ARCHITECTURE.md, DATA_SCHEMA.md, DECISIONS.md, ACCESSIBILITY.md
tests/       Cross-cutting tests; tests/e2e holds the browser checks (Playwright).
```

### The boundary that matters

`src/globe/` and `src/core/` must **never** import from `src/ui/`. This is what
makes the later native port a port instead of a rewrite.

It is enforced in two independent places:

1. **ESLint** — `@typescript-eslint/no-restricted-imports` in `eslint.config.js`,
   covering `@/ui/*`, relative `../ui/*`, `src/ui/*`, and type-only imports.
2. **A test** — `tests/boundaries.test.ts` reads the source text directly, so an
   `eslint-disable` comment does not buy a way through.

Try it: add `import { App } from '@/ui';` to any file in `src/core/`, then run
`npm run lint` and `npm run test`. Both fail.

The same rules keep React, Three.js and Zustand out of `src/core/`, Supabase and
Zustand out of `src/globe/`, and the Supabase SDK inside `src/core/db/`.

## Textures

`npm run textures` runs two steps, and takes about a minute on a warm connection:

1. `textures:fetch` downloads ~34MB of public-domain NASA imagery into
   `.textures-cache/` (outside `public/`, so it never ships) and regenerates `public/textures/SOURCES.md`.
2. `textures:build` emits 2K/4K/8K WebP variants plus
   `public/textures/manifest.json`.

Both the sources and the generated variants are gitignored — the scripts are the
source of truth, not the binaries. Edit `scripts/textures.config.ts` to change a
source URL; the tier ladder itself lives in `src/core/quality.ts` and is
re-exported to the build script so the two cannot desync.

Emitted payload per tier: **low 0.84MB, medium 1.61MB, high 4.20MB.**

Two things are not plain resizes, both explained in `docs/DECISIONS.md`:

- **The specular mask is derived**, not downloaded — NASA no longer publishes a
  standalone land/water mask, so ocean is detected by blue dominance in the
  bathymetry map.
- **Clouds are capped at 2048px on every tier**, because that is the largest
  equirectangular composite NASA publishes. Nothing is ever upscaled; the
  manifest records what was actually emitted.

### Quality tiers

Which set loads is decided by `pickTier()` in `src/core/quality.ts` — pure, and
unit-tested with mocked capability inputs. The DOM half (WebGL limits,
`navigator`, `localStorage`) lives in `src/ui/platform/capabilities.ts`, because
`src/core` must stay DOM-free.

Force a tier while testing, from the browser console:

```js
localStorage.setItem('agora.quality-tier', 'low'); // 'low' | 'medium' | 'high'
location.reload();
```

Clear it with `localStorage.removeItem('agora.quality-tier')`. The override is
still clamped by `MAX_TEXTURE_SIZE`, since that is a hard GPU limit. The current
tier and the reason for it are shown in the app footer.

### Benchmarks

The dev panel's benchmarks (globe frames, scrubbing, the discussion) post
their results to `.bench/results.jsonl`. Development React is slow enough to
skew them, so measure on a production build that keeps the dev panel:

```bash
npx vite build --mode bench
```

```bash
npm run preview
```

Then open http://localhost:4173. "Discussion benchmark (60 posts)" runs on a
fixture and needs no database: it enters, rests 5 seconds while the panel
scrolls and live posts arrive, then leaves, and reports each step's frames
slower than 60 fps. A plain `npm run build` leaves the dev panel out.

## Environment variables

`.env.example` lists everything, split into two blocks. **Anything prefixed
`VITE_` is inlined into the public bundle** — service keys live in Workers only.

## Conventions

- TypeScript strict, plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. No `any`. Explicit return types on exports.
- Files stay under ~250 lines.
- Comments explain _why_. Shader math gets the formula.
- Conventional commits, one concern per commit.
- Record non-obvious technical choices in `docs/DECISIONS.md`.

Full rules: [`CLAUDE.md`](CLAUDE.md). Product plan:
[`news-globe-build-plan.md`](news-globe-build-plan.md).

## CI

`.github/workflows/ci.yml` runs typecheck, lint, format check, test and build on
every push and pull request. The tests include the ingest Worker's, which run
on real GDELT rows kept as a fixture, so CI never calls GDELT. A second job, alongside the first, starts
Postgres with every migration and the seed, runs the pgTAP tests, and checks
that `src/core/db/types.ts` matches the schema. A third builds the app and
runs `tests/e2e` in Chromium: axe-core on every view, sheet and panel at a
desktop and a phone size, failing on any WCAG 2.2 A or AA or best-practice
violation, and the keyboard paths through them. Locally, once
`npx playwright install chromium` has fetched the browser:
`npm run test:e2e` (54 checks, about 2 minutes, no database needed).
