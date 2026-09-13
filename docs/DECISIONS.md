# Decisions

Non-obvious technical choices, newest first. One entry per decision: what, why,
and what it costs. Stack-level choices and their tradeoffs live in
[`../news-globe-build-plan.md`](../news-globe-build-plan.md) §1.

---

## 2026-09-13 — The store holds time; the sun is derived from it

Prompt 1.2 says the sun direction "must come from a store value". The value
stored is the **instant** (`timeStore.timeMs`, epoch ms) plus an `isLive` flag.
The sun direction comes from it through `sunDirection(new Date(timeMs))`.

**Why:** the scrubber (3.2) and pin fading need the same instant, so storing a
direction would mean two values that could disagree. `GlobeScene` subscribes with
`timeStore.subscribe` rather than a React selector. Dragging the slider rewrites
one uniform and schedules one frame, with no re-render in between.

**The wall clock is read in exactly one place,** `src/state/clock.ts`. ESLint
(`no-restricted-properties` / `no-restricted-syntax`) and `tests/clock.test.ts`
reject `Date.now()`, `performance.now()`, `new Date()` and `Date()` anywhere else
in `src/`. The source-scan test exists because a lint rule can be disabled with
one comment.

**Live mode** re-syncs every 30s and on tab focus, and does nothing while the tab
is hidden. The terminator moves 0.25°/min, so a 30s step is 0.125° inside an
~11°-wide soft band: not visible, and it costs one frame. It keeps running under
`prefers-reduced-motion`, because a step that small is not motion and the
lighting should stay truthful.

**Cost:** zustand 5.0.15, which is small because `useStore` sits on React's built-in
`useSyncExternalStore`. The whole of Prompt 1.2 (store, sun math, both shaders)
takes the production JS from 300.6 to 302.7 kB gzip.

---

## 2026-09-13 — Lighting is computed in the Earth-fixed frame

`sunDirection()` returns a unit vector in the same frame as `latLonToVec3`, which
is also the frame the textures use. The earth shader dots it with the object-space
`normal`, not `normalMatrix * normal`.

**Why:** the lighting is then independent of the 23.44° tilt group, the camera,
and any later spin of the globe mesh. It is just "which way is the sun from this
patch of ground". The first-frame sun is a required `createEarth` option, so the
globe never draws once with a placeholder sun. `src/core` still cannot import
three, so `sunDirection` returns a plain `Vec3` rather than the prompt's
`Vector3`; `src/globe/sunFrame.ts` converts.

---

## 2026-09-13 — City lights get their own cut-off, stricter than the blend

The prompt's blend is `mix(night * 0.9, day * max(ndl, 0), t)` with
`t = smoothstep(-0.10, 0.10, ndl)`. On its own it leaves city lights at 45% on
the terminator, and still 14% with the sun 3° above the horizon. That contradicts
the prompt's own "night lights must not bleed across the terminator".

**Decision:** keep the blend exactly as specified, but first multiply the lights
by `1 - smoothstep(-0.04, 0.0, ndl)`. That factor is exactly 0 wherever the sun is
up and reaches 1 with the sun ~2.3° down. A shader test pins the expression.

**Why 0.04 and not the band's 0.10.** The first version faded lights over the
full band, so it ended where civil twilight does. The night map, though, is not
black: it carries a dim blue base of land and ocean. The (1 - t) weight in the
blend and the mask then both faded that base toward the line. On the day side,
`day * ndl` starts from zero. Together they left a dark stripe about 0.15 globe
radii wide. Narrowing the mask roughly halves it. The ±0.10 band itself is
unchanged.

**Twilight tint** warms the day term as the sun gets low:
`mix(1, LOW_SUN_TINT, 1 - smoothstep(0, 0.25, ndl))`, with LOW_SUN_TINT = (1.0,
0.75, 0.55). Two earlier versions were tried in the browser and dropped:

- an additive-only glow at 0.045, which drew a flat brown stripe along the line;
- an additive glow at 0.012 plus a stronger tint, which still read as a brown
  band.

It stays subtle because 1.3's atmosphere adds its own reddening on HIGH.

---

## 2026-09-13 — Clouds are lit by the same terminator

With the 1.1 `MeshBasicMaterial`, clouds stayed bright white across the whole
night side, over the lights. Clouds now use a small ShaderMaterial with the same
±0.10 band. Their day term matches the ground's. At night they fall to black at
35% opacity, so they dim the lights beneath them without stamping black shapes
over cities.

The cloud shell spins relative to the ground, so it gets its own copy of the sun
rotated into its frame: `R_y(-spin)`, re-derived on every `advance()`. A test
checks that a point on the cloud shell gets the same ndl as the ground beneath it
at several spin angles, and that test fails if the sign is flipped.

---

## 2026-09-13 — React 19, not React 18

The build plan and CLAUDE.md specified React 18. Every current release in the
r3f ecosystem requires React 19: `@react-three/fiber@9`, `@react-three/drei@10`
and `@react-three/postprocessing@3`. React 18 caps the stack at r3f 8.18, drei
9.122 and postprocessing 2.19 — all maintenance-only.

**Decision:** React 19.2.8 (exact), r3f 9.7, three 0.186. Not React 19.3:
r3f 9.7 declares `react >=19 <19.3`. CLAUDE.md's stack line is updated.

**Cost:** the upgrade itself was one line — the global `JSX` namespace is gone
in `@types/react@19`, so components import `type JSX` from `react`. r3f 9.7
still uses the deprecated `THREE.Clock` internally, which logs one console
warning per load; it is r3f's, not ours. r3f also brings `zustand` in
transitively. That does not change the rule: lint still blocks importing it
from `src/core` and `src/globe`.

---

## 2026-09-13 — src/globe contains no React, not even r3f

ESLint allowed React in `src/globe`, but CLAUDE.md's directory rule says "Three.js
only. No React". The lint rule was the weaker of the two, so it was the one that
changed.

**Decision:** `src/globe` exports imperative factories — `createEarth()` returns
`{ object3d, setChannel, setCloudsVisible, advance(dt), dispose() }` — and
`src/ui/globe/GlobeScene.tsx` mounts `object3d` through `<primitive>`. React,
react-dom and `@react-three/*` are now forbidden in `src/globe` by lint.

**Why:** the native port reuses `src/globe` verbatim and replaces only the host.
It is also why textures load through `THREE.TextureLoader` rather than r3f's
`useTexture`. As a side effect, the loader returns a `Texture` immediately and
fills it later, which suits render-on-demand: one `invalidate()` per image, and
no suspense boundary.

**Cost:** lifecycle is manual. The globe is built and disposed inside a single
effect so StrictMode's double mount gets a fresh globe, not a disposed one.

---

## 2026-09-13 — lat/lon → world is pinned to SphereGeometry's UV layout

**Decision:** `src/core/geo.ts` uses `phi = (lon+180)°`, `theta = (90-lat)°`,
`x = -r·cos(phi)·sin(theta)`, `y = r·cos(theta)`, `z = r·sin(phi)·sin(theta)`.
That is THREE.SphereGeometry's vertex loop solved for its own UVs, not a textbook
convention. `src/globe/geometry.test.ts` checks it against every vertex of the
real geometry, and it fails if longitude is off by 1°.

**Consequences:** (0,0) is +X, lon −90 is +Z, and lon ±180 is −X. A camera on +Z
therefore faces the Americas, so the view presets place the camera with the same
function rather than assuming Greenwich faces +Z.

**Tilt is about X, not Z.** The first version tilted about Z. That is 23.44° in
world space, but Greenwich and the antimeridian lie on the X axis, which put both
preset cameras inside the tilt plane. The axis projected dead vertical and the
tilt could not be seen. Only the browser check caught this; every unit test
passed. There is now a test that measures the tilt as it appears on screen from
both presets.

The shader uses the geometry's UVs rather than deriving UV from position.
SphereGeometry duplicates the seam column (u = 0 and u = 1 share a position), so
u never wraps inside a triangle and no mip-derivative seam can form.

---

## 2026-09-13 — Flat, unlit output for 1.1

Checking texture mapping only works if nothing between the texture and the screen
changes the colour.

**Decision:**

- `<Canvas flat>` (NoToneMapping). r3f defaults to ACESFilmic.
- `#include <colorspace_fragment>` ends the fragment shader. A raw
  `ShaderMaterial` gets `linearToOutputTexel` defined but never called, and
  without the include the globe renders dark. A test asserts the include is
  present.
- The specular mask is sampled as `NoColorSpace` (it is data); day, night and
  clouds use `SRGBColorSpace`.
- `wrapS = RepeatWrapping` on every map, with anisotropy capped at 8.
- Clouds use `MeshBasicMaterial`. The pipeline already bakes them as white RGB
  with alpha, so no custom shader is needed.

The fragment shader samples all three maps unconditionally and selects one
with a runtime `uChannel` uniform. Because the uniform is not a compile-time
constant, no sampler can be eliminated, so switching channels actually proves
each binding. The inspection panel is `import.meta.env.DEV` only.

---

## 2026-09-13 — Clouds idle at 12fps, not 60 and not 0

"Clouds rotate slowly" and "render on demand" conflict: something that moves
forever never lets the globe idle.

**Decision:** clouds turn once every 10 minutes. While the tab is visible,
`useCloudTicker` calls `invalidate()` at 12Hz. It stops completely when the tab
is hidden, when clouds are toggled off, and under `prefers-reduced-motion`,
which also freezes the rotation. At this speed one frame moves the clouds about
0.05°, which is less than a pixel, so 12fps looks continuous. Rotation is
`rate * dt`: CLAUDE.md's exp() smoothing is for easing toward a target, and a
constant spin has none. `dt` is clamped to 0.25s, because under
`frameloop="demand"` the delta after a hidden tab can be minutes.

**Cost:** about a fifth of a 60fps loop's GPU time while visible and idle. The
alternative that honours constraint 4 literally, clouds advancing only on frames
drawn for other reasons, makes clouds look frozen on a still screen.

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
