# Global Agora

Browse the world's news on a cinematic 3D globe, scrub back through the last 24
hours to watch a story spread, and debate hot stories in structured, sided
discussions.

Web first. Native mobile is a later phase, so the code stays portable — see
[the boundary](#the-boundary-that-matters).

**Status: Phase 2.** The globe shows real news from GDELT: ingested every 15
minutes, grouped into stories, served as one compact payload. No scrubber,
story sheet or discussions yet.

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
npm run db:test    # 173 pgTAP assertions: RLS, constraints, ingest, API
npm run db:smoke   # the stories come back; every other table refuses
```

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
`npx supabase status`. Then run the Worker and the app side by side; Vite
proxies `/api` to it:

```bash
npm run api:dev
```

```bash
npm run dev
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
npx wrangler deploy -c workers/api/wrangler.jsonc
```

## Layout

```
src/globe/   Three.js only. No React, no DOM, no Supabase. Pure render layer.
src/core/    Models, types, data fetching, geo math. Framework-agnostic, no DOM.
src/ui/      React components. Tailwind. Talks to core/ and globe/.
src/state/   Zustand stores.
workers/     Cloudflare Workers: ingest/ (cron), api/ (payload), shared/.
supabase/    Migrations, RLS policies, edge functions.
docs/        ARCHITECTURE.md, DATA_SCHEMA.md, DECISIONS.md
tests/       Cross-cutting tests that do not belong to one layer.
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
that `src/core/db/types.ts` matches the schema.
