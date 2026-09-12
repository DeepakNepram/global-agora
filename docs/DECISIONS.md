# Decisions

Non-obvious technical choices, newest first. One entry per decision: what, why,
and what it costs. Stack-level choices and their tradeoffs live in
[`../news-globe-build-plan.md`](../news-globe-build-plan.md) §1.

---

## 2026-09-12 — The specular mask is derived, not downloaded

NASA retired Visible Earth into science.nasa.gov and no longer publishes a
standalone land/water mask. Natural Earth has ocean data but only as vector
shapefiles, which would mean adding GDAL or mapshaper to rasterise.

**Decision:** derive the mask in `scripts/process-textures.ts` by thresholding
blue dominance in the Blue Marble topography/bathymetry map. Ratio thresholds
(`b*100 > r*118 && b*100 > g*104`), not additive, so deep ocean (~10,30,60) and
shallow tropical water (~60,140,160) both classify while desert (~180,160,120)
and ice (~240,240,240) do not.

**Cost:** inland lakes read as specular (correct), and Antarctic sea ice reads as
land (arguably correct — ice is not a mirror). Verified visually against the day
map: coastlines are crisp and the Great Lakes, Caspian and Victoria all resolve.
Marked as a derivative, not a NASA product, in `public/textures/SOURCES.md`.

---

## 2026-09-12 — Clouds are capped at 2K on every tier

The only equirectangular cloud composite NASA publishes is 2048×1024. The
21600×21600 files in the same record are quadrant tiles at 202MB each.

**Decision:** clamp every output to its source width and record the emitted size
in the manifest. Clouds stay 2048px on the high tier rather than being upscaled
to 8192px to make the ladder look uniform.

**Cost:** cloud detail does not improve with tier. Stitching the quadrant tiles
would fix it and is not worth 800MB of download for a layer this low-frequency.

Separately, cloud alpha is encoded at `alphaQuality: 70`, not 90. WebP
compresses alpha far less aggressively than colour: 90 cost 1310KB, 70 costs
527KB with no visible difference at globe scale. That single setting was 60% of
the low tier's total payload.

---

## 2026-09-12 — Quality detection is split across the layer boundary

Prompt 0.2 asked for `src/core/quality.ts` to read WebGL limits, `navigator` and
`localStorage`. All three are DOM, and `src/core` is required to be DOM-free.

**Decision:** split it. `src/core/quality.ts` holds the pure decision —
`decideTier(capabilities, override)` and `parseTierOverride(raw)` — and
`src/ui/platform/capabilities.ts` does the measuring. Same shape as
`resolveConfig(env)`.

**Why this way round:** the probe is the platform adapter, so it is exactly the
file a native port replaces. Keeping it in `src/ui` means the port swaps one
file and the tier policy travels unchanged. It also makes the policy testable
with plain objects — no jsdom, no GL stubbing.

A manual override forces the tier but is still clamped by `MAX_TEXTURE_SIZE`,
because forcing `high` onto a GPU that cannot upload an 8192px texture renders a
black globe, which is a worse debugging experience than being quietly capped.

---

## 2026-09-12 — sharp as a devDependency; textures are gitignored

**sharp** (+7 packages) is build-time only and never enters the client bundle, so
bundle cost is zero. It is the only practical way to do the raw-pixel work the
mask derivation and cloud alpha need.

**Decision:** generated textures and their sources are gitignored. The repo
keeps `SOURCES.md` and the scripts; `npm run textures` reproduces ~34MB of
downloads and ~5.7MB of output.

Downloaded originals live in `.textures-cache/` at the repo root, **not** under
`public/`. Vite copies `public/` into `dist/` verbatim, so holding them there
shipped 35MB of raw NASA JPEGs to production: `dist` was 41MB for ~6MB of real
textures. Caught by checking `dist/` after a build rather than trusting that
`public/` only contained what should ship.

**Cost:** a fresh clone cannot build a working globe without network access, and
CI/Cloudflare Pages will need `npm run textures` in the build step before Phase 1
ships. Committing ~8MB of binaries to git forever is the worse trade.

---

## 2026-09-12 — scripts/ runs on node's type stripping, not tsx

**Decision:** `node --experimental-strip-types scripts/*.ts`. No new runner
dependency.

**Cost:** node does no extension resolution, so imports inside `scripts/` carry
explicit `.ts` specifiers and `tsconfig.json` sets `allowImportingTsExtensions`.
`scripts/` is in the tsconfig `include`, so the build tooling is typechecked like
everything else.

---

## 2026-09-12 — TypeScript pinned to 5.9.x, not 7.x

TypeScript 7.0 is released, but `typescript-eslint@8.70` declares
`typescript >=4.8.4 <6.1.0`. Installing TS 7 breaks every type-aware lint rule.

**Decision:** pin `typescript` to `~5.9.3` until typescript-eslint ships TS 7
support, then bump both together.

**Cost:** missing TS 7 features and the native-port compiler speedup. Revisit
when typescript-eslint publishes a major with a wider peer range.

---

## 2026-09-12 — The src/ui boundary is enforced twice

CLAUDE.md's "do not cross it" only holds if crossing it fails the build.

**Decision:** enforce with both `@typescript-eslint/no-restricted-imports`
(patterns cover `@/ui`, `../ui`, `src/ui`, and type-only imports) and
`tests/boundaries.test.ts`, which reads source text directly.

**Why both:** a lint rule dies to one `// eslint-disable-next-line`. The test
does not read disable comments, so the boundary survives a moment of
expedience at 1am. The test also carries a self-check so it cannot pass
vacuously if the detector regex stops matching.

**Cost:** two places to update if the layer layout changes.

The same mechanism additionally keeps React/Three/Zustand out of `src/core` and
Supabase/Zustand out of `src/globe`, matching the "Directory rules" section.

---

## 2026-09-12 — Config is injected into src/core, not read from import.meta.env

`import.meta.env` is a Vite global. Reading it inside `src/core` would tie the
framework-agnostic layer to the web bundler and break under a native shell.

**Decision:** `resolveConfig(env)` takes an env bag as an argument.
`src/main.tsx` is the only place that touches `import.meta.env`.

**Cost:** one extra prop threaded from the composition root. Buys testability
(no global stubbing in `config.test.ts`) and portability.

---

## 2026-09-12 — Tailwind 4 (CSS-first), no tailwind.config.js

**Decision:** Tailwind 4.3 via `@tailwindcss/vite`. Design tokens live in an
`@theme` block in `src/ui/styles/index.css`.

**Cost:** most Tailwind snippets and LLM output assume v3's `tailwind.config.js`
and will need translating. Buys a faster build and no PostCSS chain.

---

## 2026-09-12 — Single tsconfig.json instead of project references

The Vite template splits into `tsconfig.app.json` / `tsconfig.node.json` with
`composite: true`. Composite requires declaration emit, which fights `noEmit`
and makes `npm run typecheck` fragile.

**Decision:** one `tsconfig.json` with `noEmit`, covering `src/`, `tests/`,
`workers/` and `vite.config.ts`. `typecheck` is a plain `tsc --noEmit`.

**Cost:** `workers/` currently typechecks against the DOM lib. It gets its own
tsconfig plus `@cloudflare/workers-types` when Phase 2 writes the real handler.

---

## 2026-09-12 — Deliberately not installed yet

Three.js, r3f, drei, postprocessing, Supabase (per instruction), and **Zustand**
— there is no store to hold yet, and an unused dependency is a decision made too
early. `src/state/index.ts` is a documented empty barrel until Phase 1.

Also skipped: `jsdom` and `@testing-library/react`. Nothing renders yet, so tests
run in the `node` environment. Add both when Phase 1 has components to mount.
