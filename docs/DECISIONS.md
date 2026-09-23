# Decisions

Non-obvious technical choices, newest first. One entry per decision: what, why,
and what it costs. Stack-level choices and their tradeoffs live in
[`../news-globe-build-plan.md`](../news-globe-build-plan.md) §1.

---

## 2026-09-23 — Cold start: a preloaded low-resolution Earth first, then full maps day-first

**The budget** is "cold start to interactive under 2 s". Interactive here
means the Earth's map is on screen **and** dragging works. Input is ready
well before the maps arrive, but until then the globe is a black ball of
pins; on the phone profile that was still the picture at 1.5 s, so input
readiness alone is not counted.

**The first measurement missed on phones.** Nothing requested a map until
the JavaScript (319 KB gzip) had arrived and run. Then all four MEDIUM maps
(1.65 MB) shared the connection, and the day map lost bandwidth to 527 KB of
clouds.

**The fix:**

- `index.html` preloads LOW's day and night maps (272 KB), so they download
  alongside the JavaScript. The preload uses `crossorigin="anonymous"` to
  match three's `TextureLoader`; a mismatch would download each map twice
  (a test checks this). The globe draws these maps first.
- The tier's maps replace them in stages: day alone, then night and clouds,
  then specular, which the lit view does not read.
- On LOW the preview maps are the final maps, so LOW downloads nothing
  extra.
- The loader hands out uniform-shaped slots that the materials use directly,
  so a swap is one assignment. A preview that lands after its full map is
  discarded.

**Method.** The production build is served by `vite preview --mode lan`.
Requesting `/?coldstart` returns it with `scripts/vite/coldStartProbe.ts`
injected as the first script. The probe records:

- first paint;
- the first WebGL draw;
- when the globe starts accepting input;
- the upload of each map (a map appears in the frame it is uploaded in).

It posts the results to `.bench/results.jsonl`. "Cold" means the cache and
storage were cleared (headless Chrome) or a fresh Incognito session was used
(the phone). Figures are medians of 3 runs, in seconds from navigation start.

| Profile                                       | Tier   | Earth on screen, before → after | Full day map | All maps | Download |
| --------------------------------------------- | ------ | ------------------------------- | ------------ | -------- | -------- |
| Laptop, no throttling                         | MEDIUM | 0.34 → **0.33**                 | 0.47         | 0.64     | 2.24 MB  |
| Big monitor, 50 Mbit/s, 20 ms                 | HIGH   | 1.69 → **0.42**                 | 1.10         | 1.76     | 4.90 MB  |
| Phone profile: 9 Mbit/s, 60 ms, CPU 4×        | MEDIUM | 2.90 → **1.44**                 | 2.25         | 3.16     | 2.24 MB  |
| Lighthouse mobile: 1.6 Mbit/s, 150 ms, CPU 4× | MEDIUM | 11.6 → 4.15                     | 7.71         | 13.14    | 2.24 MB  |
| Adreno 610 phone, Wi-Fi, real device          | MEDIUM | n/a → **0.83** (worst 1.24)     | 1.18         | 1.74     | 2.24 MB  |

- The 4× CPU profile is a fair stand-in for the phone. From the JavaScript
  arriving to the Earth on screen, the real phone took about 0.7 s and the
  profile 0.72 s. So on good 4G the phone should land near 1.4–1.5 s, but
  that figure is inferred, not measured on a cellular connection.
- The before runs were over HTTP and the after runs over HTTPS.
- The network profiles are Chrome's emulation: latency per request and
  bandwidth shared evenly, with no HTTP/2 prioritisation. Real 4G varies.

**Costs:**

- MEDIUM and HIGH download 272 KB more.
- The preloads share the connection with the JavaScript, so it arrives
  later: by 0.23 s on the phone profile and by 1.3 s on Lighthouse mobile,
  which is exactly 272 KB at 1.6 Mbit/s. That is still a large win, because
  the Earth appears at 4.2 s instead of 11.6 s.
- Loading in stages makes "all maps" later on good 4G (2.90 → 3.16 s). By
  then the Earth has been on screen for 1.7 s.

**Known limit:** Lighthouse's slow 4G profile stays over 2 s. The
JavaScript alone needs about 1.6 s to transfer at 1.6 Mbit/s, before
round-trips. Meeting 2 s there would take a smaller first bundle (splitting
three, postprocessing and the app), which is a separate project. The budget
is judged on good 4G and the real phone.

---

## 2026-09-23 — Phone benchmarks are paired, run with the screen awake and the dev overlays hidden

The first two phone runs of Prompt 1.5 disagreed with the clean one by 30%.
Both mistakes were in the method, not the renderer:

| Run (Adreno 610, MEDIUM)                     | Pins off | 3000 pins |
| -------------------------------------------- | -------- | --------- |
| Landscape: the canvas was only 164 px tall   | 57.6 fps | 52.7 fps  |
| Portrait, dev overlays shown, fixed order    | 35.3 fps | 31.2 fps  |
| Portrait, clean method (below), two sessions | 47.1 fps | 40.2–40.6 |

- **Dev overlays.** The debug panels' backdrop blur covered half the portrait
  screen and was recomposited every frame. Production has no such panels, so
  the benchmark now hides them (the `hidden` attribute, not unmounting, so the
  run keeps going) and shows a plain status line instead.
- **Run order.** Pins off always ran first, so a phone warming up billed its
  slowdown to the pins. The benchmark now does a warm-up run, then three
  off/3000 pairs in alternating order, and reports medians of the paired
  difference.
- **Screen sleep.** Android turned the screen off mid-run, which pauses
  rendering, so one frame interval lasted minutes and a 10,000-pin run read
  1 fps. A screen wake lock is now held for the run (the LAN dev server is
  HTTPS, which the wake lock needs), and any run during which the page was
  hidden is flagged and left out of the medians.

Separately, on this laptop the GPU reads 2–3× slower on battery. Desktop
figures are only recorded on mains power.

Results travel from the phone to the development machine without copying:
the dev server accepts `POST /__bench` (JSON appended to the gitignored
`.bench/results.jsonl`) and `POST /__capture` (a canvas PNG). Both exist only
under `vite serve`, write fixed file names and cap body size. A quality-tier
switch (Auto / Low / Medium, reloads) lets the same run go on LOW from the
phone. High is left out: its 8K textures could exhaust a phone's memory, and
the override persists, so a crash would repeat on every load.

---

## 2026-09-23 — Pins: one InstancedMesh of clip-space quads, fed from one interleaved buffer

**Structure.** `src/globe/pins/` draws every story with one `InstancedMesh`
of camera-facing quads (CLAUDE.md constraint 2):

- The quad is built in clip space, so a pin keeps its pixel size at every
  altitude: `clip.xy += corner · halfSizePx · (2 / viewport) · clip.w`.
- Every per-pin value lives in one `InstancedInterleavedBuffer`: 12 floats,
  48 bytes a pin. `updateInstances(nodes)` is one pass over the `NodeBuffer`'s
  typed arrays and one upload, limited to the live rows with `addUpdateRange`,
  with no per-pin allocation.
- `instanceMatrix` stays identity and is never read. The pin position is its
  own attribute because the quad is built after projection.
- Growing past capacity replaces the mesh rather than adding one.

**Look.** The dot, a soft dark ring and the halo come from one draw with
premultiplied blending (`ONE, ONE_MINUS_SRC_ALPHA`):

- the dot has alpha 1, so it covers what is under it;
- the ring has alpha 0.4 and no colour, so it darkens, which gives the dot an
  edge over sunlit desert and cloud;
- the halo has alpha 0, so it only adds light.

Hues are scaled so their brightest channel is 1. Fresh stories add a white-hot
centre, and that centre is what crosses the bloom threshold, for about their
first 4.8 hours. Colour alone never can. Halos are weighted by the cosine of
the view angle to the ground, so foreshortened pins crowding the limb do not
sum into a bright ring.

The first version scaled hues to equal luminance and lifted fresh pins to
2.0. ACES flattened red and blue (up to 4× in one channel) into pastels, and
the limb glowed as a solid ring. Both were caught in screenshots, not tests.

**Horizon.** The prompt's rule hides a pin when
`dot(normalize(P), normalize(cam)) < R / |cam|`. It fades in over a band 10%
of the visible cap's depth wide, so the fade is a few degrees from orbit and
a few kilometres from 50 km up. A hidden pin's vertices go outside the clip
volume, so it rasterises nothing. Depth testing is off: the globe is the only
occluder, and the horizon test handles it exactly with no z-fighting against
clouds.

**Pulse.** `scale = base · (1 + 0.15 · sin(t · rate + phase) · recency)`:

- recency is `exp(−age / 6 h)`;
- rate goes from 0.25 Hz (old) to 1 Hz (new);
- the phase comes from the publish time (a Weyl sequence), so stories
  published seconds apart do not pulse in step.

Moving the displayed time changes every rate. Each phase absorbs
`clock · (oldRate − newRate)`, so scrubbing never makes a pin jump. The pulse
clock is rebased every 600 s, before float32 precision could show.

**Frames.** The user chose a full-rate pulse. While pins pulse, the globe draws
at display rate, even when idle. Under reduced motion the pins hold still and
the globe idles at 0 frames. Measured: reduced motion 0/s; full motion
120/s; full motion with pins hidden 0/s. This trades battery and phone heat for
a living globe (see "not measured" below).

**Mock data** (`src/core/mockNodes.ts`) is seeded, uniform by area, and spread
over the configured history window, and it shows in every build until Prompt
2.3. The header says the pins are placeholder data.

**Measured, world view (the worst case, with the most pins on screen):**

| Device                                    | Tier   | Pins off           | 3000 pins           | Pins cost       |
| ----------------------------------------- | ------ | ------------------ | ------------------- | --------------- |
| Iris Xe, 1084×610 @1.25, mains            | HIGH   | GPU 4.5 ms         | GPU 5.4 ms, 144 fps | +0.9 ms         |
| Iris Xe, same                             | MEDIUM | GPU 4.3 ms         | GPU 4.6 ms, 144 fps | +0.3 ms         |
| Adreno 610, Android 10, portrait 720×1025 | MEDIUM | 47.1 fps (21.2 ms) | 40.2–40.6 fps       | +3.4–3.7 ms     |
| Adreno 610, same                          | LOW    | 60.4 fps (vsync)   | 60.4 fps            | hidden by vsync |

- Desktop figures are medians of 6 alternating pairs; the p95 GPU time was at
  most 6.3 ms. 144 fps is the display's refresh rate.
- Phone figures are medians of 3 pairs, with the frame rate taken from frame
  intervals because the phone has no GPU timer. The phone's p95 interval is
  about 35 ms with or without pins, which comes from the MEDIUM pipeline, not
  the pins.
- One scrub tick (sun plus all 3000 pins rewritten) costs 0.125 ms of CPU.
- 10,000 pins cost about 2 ms of desktop GPU over the baseline (paired, but
  measured on battery). Not re-measured on mains power or on the phone.

**Where the phone's time goes.** The MEDIUM composer (half-float, 4× MSAA,
half-resolution bloom) costs at least 4.7 ms over LOW. LOW is vsync-capped, so
the true gap is larger. Pins cost more on MEDIUM than on LOW because every pin
fragment blends into that 4× MSAA half-float buffer. At 3000 pins the frame is
25 ms against a 33.3 ms budget.

This is also the first Android measurement of the 1.3 pipeline. MEDIUM holds
47 fps without pins, so the no-bloom fallback 1.3 named is not needed yet.

**Not measured:** sustained heat. Each run lasted about 2 minutes. With the
pulse at display rate, a phone renders flat out whenever the globe is
visible, and a 10-minute soak may show throttling. Available levers, if needed:

1. Trim the pin quad to where the halo is visible. Beyond r ≈ 0.75 the halo is
   below 3%, so this means about 44% fewer pin fragments.
2. Cap mobile pixel density at 1.5×.
3. Drop MSAA or bloom on MEDIUM.

**Cost:** +4.0 kB gzip of JS (327.5 → 331.5 kB). No new dependencies.

---

## 2026-09-14 — The camera is north-up, which supersedes the visible 23.44° lean

Prompt 1.4's controls keep Earth's north as screen-up. A horizontal drag moves
along a latitude, a vertical drag moves along a meridian, and the pitch clamp
(±85°) sits at the real poles.

**Why:** the 1.1 view presets kept world-up as screen-up so the tilt showed as a
lean. That cannot coexist with orbiting: drags would run diagonally on screen at
most longitudes, and "up" near the poles would swing as the globe turned. Google
Earth, earth.nullschool.net and windy.com are all north-up.

**Cost:** the lean is no longer visible on screen. The tilt still shows through
the terminator's seasonal angle, and `earthTiltQuaternion` still orients the
globe; the camera rig composes it as its body orientation. The 1.1 test
"tilt visible on screen from the presets" was removed with `aimCamera`.

---

## 2026-09-14 — OrbitGlobeControls: DOM-free input, screen-space inertia, iterated zoom anchor

`src/globe/camera/` takes plain input (canvas-relative CSS pixels plus the
event's `timeStamp`) and moves only in `update(dt)`.
`src/ui/globe/bindControlInput.ts` is the only file that touches DOM events, so a
native host replaces that file and nothing else. It binds to the r3f event element
(focusable, `role="application"`, `touch-action: none`). Keys are bound to that
element rather than the window, so arrows never fight the time slider.

**Pose:** a quaternion `q` in the Earth-fixed frame plus altitude. The world pose
is `tilt · q`, with the camera at `q·(0,0,1+alt)`. Yaw is pre-multiplied (about
Earth's axis) and pitch is post-multiplied (about the camera's right axis), so
roll stays zero. No Euler objects and no `lookAt`. The public pose is plain
`{ lat, lon, altitudeKm }`, for the discussion panel and share URLs.

**Drag:** `rad per screen height = 2·tan(fov/2) · altitude / R`. The base is the
ground span of one screen height looking straight down, so at 50 km the ground
stays under the finger (tested within 2% by raycasting a real camera). Yaw is
divided by `max(cos lat, 0.35)` so horizontal drags keep their ground speed at
high latitudes.

**Inertia** is stored in screen heights per second, not radians. The stop
threshold (0.02) and the flick cap (8) then mean the same thing at every
altitude. Each step moves by the exact integral `v(1−e^(−f·dt))/f`, so total spin
is identical at 30, 60 and 144 fps. Friction is derived rather than tuned by eye:
`f = ln(4 / 0.02) / 2.5 ≈ 2.12/s`, so a 4 screen-heights/s flick spins 2.5 s
(measured 2.67 s including 100 ms polling in Chrome). A pointer that rests 50 ms
before lifting does not coast.

**Zoom anchor:** rotate the rig by `fromUnitVectors(P′, P)`, rebuild north-up
from the new centre, and repeat until the hit is within 1e-10. The first version
stopped after two passes. That left about 1e-3 rad per frame, which compounded
to 160 px by city altitude. The iteration converges about 4× per pass, typically
8–10 passes of a few vector operations. Measured in Chrome over 49 real wheel
events from 19,113 km down to 50 km: 0.0001 px (8 mm). Pinch applies altitude
directly (not smoothed) and uses the same anchor at the finger midpoint, so a
two-finger drag also pans.

**flyTo:**

- Duration is `800 + 2200·√(angle/π)` ms. Measured against plan in Chrome: Paris
  1088/1088 ms, New York 1961/1953 ms, Sydney 2827/2832 ms.
- Altitude follows a parabola in log space, peaking at `1.2 R · angle` and never
  below either end, so short hops don't rise.
- Lateral progress is weighted by altitude, `u = ∫h / ∫h`. The ground's on-screen
  speed is then independent of altitude: the camera climbs, travels near the top,
  and descends. The departure city does not smear sideways while the camera is
  still low.
- Cancellation resolves `'cancelled'` rather than rejecting, so an interrupted
  flight is not an unhandled rejection.

**Render on demand:** input calls `invalidate` through `requestFrame`, and
`update` asks for the next frame only while inertia, zoom or a flight is running.
r3f's first delta after idle spans the whole idle gap, so the first step is
capped at 1/60 s. Measured: idle 0 frames, 0 frames the second after a flick
stops, 0 after arrival.

**Clip planes** follow altitude (`near = 0.3·alt`). A fixed near of 0.1 would
clip the globe below ~600 km.

**Reduced motion** is honoured now, not in Prompt 5.1, because CLAUDE.md says
accessibility is not a later phase. Flights cut, there is no inertia, and wheel
zoom is instant. The developer machine has reduced motion on, so the dev panel
has "Force full motion" (M) for feel testing.

**Frame cost:** unchanged by camera pose. On HIGH at 1040×670 (Iris Xe, a slower
GPU power state than in the 1.3 measurements), the GPU mean was:

| Build / pose          | GPU mean    |
| --------------------- | ----------- |
| 1.3 build, world view | 7.8–10.9 ms |
| 1.4 build, world view | 8.1–10.6 ms |
| 1.4 build, 600 km     | 6.8–7.3 ms  |
| 1.4 build, 50 km      | 7.0–7.3 ms  |

The 1.3 build was measured minutes before the 1.4 builds, in the same tab.

**Known, left for a later LOD pass:** below a few hundred km the imagery is soft
(the 8K map is 4.9 km per texel) and the 2K cloud shell becomes a smear.

**Cost:** +4.2 kB gzip of JS (323.3 → 327.5 kB). No new dependencies.

---

## 2026-09-13 — Postprocessing uses `postprocessing` directly, and LOW has no composer

CLAUDE.md's stack lists `@react-three/postprocessing`. We use the underlying
`postprocessing` library (6.39.5) instead, wrapped in `src/globe/renderPipeline.ts`.

**Why:** the React wrapper also pulls in `n8ao` and `maath`, which we don't use.
It would also move frame composition into React, whereas `src/globe` is where
drawing lives and the native port reuses it. The host is one r3f `useFrame` at
priority 1 (`src/ui/globe/useRenderPipeline.ts`), which also stops r3f's own
`gl.render`.

**Per tier** (`src/globe/renderSettings.ts`):

|            | LOW                 | MEDIUM              | HIGH                |
| ---------- | ------------------- | ------------------- | ------------------- |
| Atmosphere | rim                 | rim                 | 6-sample scattering |
| Composer   | none                | half-float, 4× MSAA | half-float, 4× MSAA |
| Bloom      | off                 | half resolution     | full resolution     |
| ACES       | three, per material | `ToneMappingEffect` | `ToneMappingEffect` |
| Vignette   | CSS gradient        | `VignetteEffect`    | `VignetteEffect`    |

On MEDIUM and HIGH, bloom, ACES and the vignette are merged into one
`EffectPass`, which is a single full-screen draw. LOW draws straight to the canvas
and gets r3f's default ACES through `#include <tonemapping_fragment>`. That
include compiles to nothing when a composer renders to a buffer. LOW's CSS
vignette is derived from the same `VIGNETTE` parameters
(`src/ui/globe/vignette.ts`). It costs no GPU pass, but it will not appear in a
future canvas capture.

**Clear colour:** the page colour is set as `scene.background`, not with
`setClearColor`. three converts a clear colour for whichever target is bound at
the time it is set, which is the sRGB canvas. The composer's clear of its linear
buffer then reused those numbers, so the background came out sRGB-encoded twice
(a visible slate blue).

**Cost:** +20.6 kB gzip of JS (302.7 → 323.3 kB). About 18 kB of that is
`postprocessing`, tree-shaken to the five classes used.

---

## 2026-09-13 — Selective bloom is a luminance budget, not a bloom setting

Prompt 1.3 asks for "only city lights and pins bloom, not the whole day side". In
an LDR buffer a sunlit white cloud is as bright as a city, so no bloom threshold
can separate them. The scene therefore renders to half-float, and every layer is
kept inside a band (`src/globe/hdr.ts`, checked by `hdr.test.ts`):

- The day side and clouds are ≤ 1, because albedo, Lambert and tint are all ≤ 1.
- The atmosphere is capped below the threshold.
- City-light cores are > `BLOOM_THRESHOLD` (1.05, smoothing to 1.30).

**The city-light gain is keyed on the texel's own luminance.** A flat ×2.4 also
lifted the night map's blue-grey base and painted the night ocean navy.
Measured on `night-8192.webp`: ocean ~0.012 linear, p99 luminance 0.06,
p99.9 0.64. The gain is `mix(0.9, 2.4, smoothstep(0.05, 0.5, luminance))`. The
base keeps 1.2's 0.9 and the cores reach 2.4.

**Pins (1.5)** must emit above `BLOOM_THRESHOLD` to bloom, and must stay below
it if they should not.

---

## 2026-09-13 — Two atmospheres behind the tier

Both run on the back faces of a 1.03-radius shell, in the Earth-fixed frame of
`uSunDir`. The camera is moved into that frame in `onBeforeRender`.

**Rim (LOW/MEDIUM).** This is the prompt's
`pow(1 - abs(dot(viewDir, normal)), 3)`. On a back face that term peaks at the
shell's own silhouette, which would draw a hard outer ring. So it is multiplied
by a falloff on the altitude of the ray's closest approach to the centre. Sun
facing is taken at that closest point, the limb under the ray, rather than at the
far-side fragment. Depth test stays on, so the Earth rejects everything behind
the disc before shading.

**Scattering (HIGH).** The shader takes six samples along the view ray between
the shell and the ground. Details:

- Rayleigh 1/λ⁴ ratios, plus a grey aerosol term with a Henyey-Greenstein phase.
- Optical depth toward the sun uses the closed-form air mass `1/(mu + 0.02)`
  instead of a second march.
- Depth test is off, so the haze also lies over the limb.
- Blending is premultiplied, with in-scatter capped at `alpha × 0.9`, so haze over
  a white cloud cannot cross the bloom threshold.

The sunset reddening comes from the air mass. Blue is stripped only within about
2° of the horizon, so the warm band stays at the terminator.

Two tuning failures are recorded here so they are not repeated:

- **β too high.** Physically sized Rayleigh extinction (blue ×16) washed the
  Pacific teal-grey. At ×6 the vertical depth is ~0.05 and the limb path is ~30×
  longer.
- **Wrong alpha.** Alpha was the mean of the three channels' extinction. Blue
  in-scatter then always hit the cap and was flattened to green's level. Alpha is
  now the strongest channel's extinction.

---

## 2026-09-13 — Frame cost is measured with GPU timer queries

The dev overlay (`src/ui/globe/FrameTimeOverlay.tsx`) reports two numbers:

- **CPU:** the JS time spent inside the draw call. It reads
  `monotonicNowMs()`, a second sanctioned export of `src/state/clock.ts`, for
  durations only.
- **GPU:** measured with `EXT_disjoint_timer_query_webgl2`. Results from disjoint
  intervals are discarded.

A frame interval would only show vsync. "Benchmark" draws 30 warm-up frames and
then 300 measured frames continuously. Everything else stays render-on-demand, and
the overlay reads "Drawn 0/s" when idle.

**Measured 2026-09-13.** Intel Iris Xe (integrated), Chrome, 1020×670 physical
pixels, India at 00:30 UTC, clouds on, reduced motion on. Figures are GPU mean /
p95 ms, the median of runs 2–6 after a reload per tier.

| Tier   | GPU mean | GPU p95 | CPU mean |
| ------ | -------- | ------- | -------- |
| LOW    | 2.5      | 3.2     | 0.12     |
| MEDIUM | 3.7      | 4.4     | 0.33     |
| HIGH   | 4.4      | 4.8     | 0.38     |

HIGH ablations on one page, 3 alternating repeats:

| Atmosphere | Bloom | GPU mean |
| ---------- | ----- | -------- |
| rim        | off   | 3.5      |
| rim        | on    | 3.8      |
| scattering | off   | 4.2      |
| scattering | on    | 4.6      |

So on this machine the scattering atmosphere costs ~0.7 ms, full-resolution bloom
~0.35 ms, and the composer plus larger textures ~1 ms. HIGH costs ~1.9 ms more
than LOW. Both are far inside 16.7 ms.

Run-to-run spread is ±0.5 ms: the GPU's power state drifts, and the first run
after a reload is always slower.

**Not measured:** mid-range Android. A 2× phone fills ~3.8× these pixels, and
MEDIUM's half-float MSAA plus bloom is the biggest risk to the 30 fps budget.
Measure before Phase 1 ships. The fallback is MEDIUM without bloom.

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
