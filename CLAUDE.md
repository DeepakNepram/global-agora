# CLAUDE.md

Project context for Claude Code. Read this before any task.

## What this is

Global Agora: a web app where people browse world news on a cinematic 3D globe, scrub back through the last 24 hours to watch stories spread, and debate hot stories in structured, sided discussions.

Web first. Native mobile is a later phase, so code must stay portable.

## Stack

- Vite + React 18 + TypeScript (strict)
- Three.js via @react-three/fiber, @react-three/drei, @react-three/postprocessing
- Zustand for state
- Tailwind CSS
- Supabase (Postgres + PostGIS + Auth + Realtime + RLS)
- Cloudflare Workers (cron ingest, API edge) and Cloudflare Pages (hosting)
- Vitest + Playwright

## Directory rules

```
src/
  globe/      Three.js only. No React, no DOM, no Supabase. Pure render layer.
  core/       Models, types, data fetching, geo math. Framework-agnostic. No DOM.
  ui/         React components. Tailwind. Talks to core/ and globe/ through interfaces.
  state/      Zustand stores.
workers/      Cloudflare Workers: ingest cron, API endpoints.
supabase/     Migrations, RLS policies, edge functions.
docs/         ARCHITECTURE.md, DATA_SCHEMA.md, DECISIONS.md
```

`src/globe/` and `src/core/` must never import from `src/ui/`. This boundary is what makes the later native port possible. Do not cross it.

## Hard constraints

1. **Performance budgets.** 60fps desktop, 30fps minimum on mid-range Android in Chrome. Cold start to interactive under 2s. Initial data payload under 150KB compressed. Never exceed these; if a change would, say so and propose an alternative.
2. **One InstancedMesh for all pins.** Never one mesh per pin.
3. **Frame-rate-independent smoothing.** Always `x += (target - x) * (1 - Math.exp(-k * dt))`. Never `lerp(x, target, 0.1)`.
4. **Render on demand.** The globe must stop rendering when nothing is moving.
5. **No precise user location, ever.** No GPS, no coordinates in the database. The local badge is a coarse text label derived from the Cloudflare IP header at post time and nothing else.
6. **No full article text.** Headline, snippet, and a link out. Never store or display article bodies.
7. **500 character limit** on discussion posts, enforced in the database and the UI.
8. **RLS on every table.** No table ships without row-level security policies.
9. **No secrets in the client.** Service keys live in Workers only.
10. **Accessibility is not a later phase.** Every interactive element needs a keyboard path and an ARIA label as it is built.

## Style

- TypeScript strict. No `any`. Explicit return types on exported functions.
- Small files. Split anything over ~250 lines.
- Comments explain _why_, not _what_. Shader math gets a comment with the formula.
- No new dependency without saying why in the response and checking bundle cost.

## Working agreement

- **Plan before code.** For any task touching more than two files, output a short plan and wait for approval.
- **One concern per commit.** Conventional commits.
- **Every task ends with a verification command** I can run, plus what I should see.
- **If a requirement is ambiguous, ask.** Do not invent product behaviour.
- **If you cannot meet a performance budget, stop and say so.** Do not silently ship something slow.
- Update `docs/DECISIONS.md` whenever you make a non-obvious technical choice.

## Things that are deliberately out of scope for v1

Direct messages. Anonymous posting. Follower counts. Infinite scroll. Full-text article storage. Native apps. Payments. Machine-learning ranking. Do not build these, do not scaffold for them, but do not make them impossible either.

## Monetization hooks (present, unused)

`profiles.tier`, a `feature_flags` table, and config values for history depth, saved-story limits, and alert counts. Never hardcode a limit that might become a paid tier boundary.
