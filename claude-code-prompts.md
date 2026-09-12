# Claude Code Build Prompts — Global Agora

Run these in order. Each is designed to be one focused session. Do not merge two prompts into one session; long sessions drift.

**Before you start:**

1. Create the repo, `cd` into it, run `claude`.
2. Drop `CLAUDE.md` into the repo root before your first prompt.
3. Use plan mode (`shift+tab` twice) for any prompt marked **[PLAN FIRST]**.
4. New git branch per prompt. Merge only when the acceptance criteria pass.
5. After each session, run `/compact` before starting the next one.

---

## PHASE 0 — Foundations

### Prompt 0.1 — Scaffold

```
Set up the project skeleton described in CLAUDE.md.

Create:
- Vite + React 18 + TypeScript (strict mode, noUncheckedIndexedAccess on)
- Tailwind CSS configured
- ESLint + Prettier, with an import rule that BLOCKS imports from src/ui
  inside src/globe and src/core. This boundary is load-bearing; enforce it in lint.
- Vitest with one passing smoke test
- The exact directory structure from CLAUDE.md, with an index.ts in each
- .env.example listing every env var we will need
- GitHub Actions CI: typecheck, lint, test on push
- docs/ARCHITECTURE.md, docs/DATA_SCHEMA.md, docs/DECISIONS.md as stubs
- .gitignore, README with setup steps

Do not install Three.js or Supabase yet.

Finish by giving me the commands to verify everything works and what output
I should expect from each.
```

### Prompt 0.2 — Asset pipeline

```
Set up the texture asset pipeline.

We need these Earth textures, all public domain:
- NASA Blue Marble day map
- NASA Black Marble night lights
- A land/ocean specular mask
- A cloud layer with alpha

Write scripts/fetch-textures.ts that downloads them to public/textures/,
plus a script that generates 2K / 4K / 8K variants using sharp.

Then write src/core/quality.ts: detects device capability (max texture size,
renderer string, device memory, screen size) and returns 'low' | 'medium' | 'high'.
This picks which texture set loads. Include a manual override that reads from
localStorage so I can force a tier while testing.

Write unit tests for the tier logic with mocked capability inputs.

Do not download anything requiring an API key or attribution beyond NASA's
public domain terms. Note the source URL for each texture in a
public/textures/SOURCES.md.
```

---

## PHASE 1 — The Globe

### Prompt 1.1 — Sphere and materials **[PLAN FIRST]**

```
Build the base Earth in src/globe/. Pure Three.js, no React below the r3f wrapper.

Requirements:
- Sphere geometry, 128 segments, radius 1.0 in world units (real-world scale
  conversions live in src/core/geo.ts)
- Custom ShaderMaterial that samples the day texture, night lights texture,
  and specular mask
- Slight axial tilt (23.44 degrees)
- A separate transparent cloud sphere at radius 1.003 that rotates very slowly
- One <Canvas> in src/ui/GlobeCanvas.tsx that mounts it
- Render-on-demand: frameloop="demand", invalidate() only when something changes

Do NOT add lighting or the terminator yet. For now light it flat so I can
confirm the textures map correctly with no seam at the antimeridian and no
pinching at the poles.

Verification: give me a command to run and tell me exactly what to look for
to confirm the UV mapping is correct.
```

### Prompt 1.2 — Sun position and terminator

```
Add real-time solar lighting.

1. In src/core/sun.ts, implement subsolar point from a JS Date (UTC):

   n = julianDay - 2451545.0
   L = (280.460 + 0.9856474 * n) mod 360
   g = (357.528 + 0.9856003 * n) mod 360
   lambda = L + 1.915*sin(g) + 0.020*sin(2g)
   epsilon = 23.439 - 0.0000004 * n
   declination = asin(sin(epsilon) * sin(lambda))
   Then equation of time -> subsolar longitude.

   Export subsolarPoint(date) -> {lat, lon} and sunDirection(date) -> Vector3.
   Unit test against known values: equinoxes and solstices, subsolar latitude
   should be ~0 and ~±23.44.

2. In the fragment shader, blend day to night across the terminator:

   float ndl = dot(normal, sunDir);
   float t = smoothstep(-0.10, 0.10, ndl);
   vec3 col = mix(nightLights.rgb * 0.9, dayTex.rgb * max(ndl, 0.0), t);

   Add a warm tint in the twilight band. Night lights should only be visible
   on the dark side and must not bleed across the terminator.

3. The sun direction must come from a store value, not Date.now() directly.
   The time scrubber will drive it later. This is important; do not hardcode
   the current time anywhere in the render path.

Verification: a debug panel with a time slider so I can drag through 24 hours
and watch the terminator sweep. Confirm sunrise over India happens at the
right UTC hour.
```

### Prompt 1.3 — Atmosphere

```
Add the atmosphere glow. Two implementations behind the quality tier:

LOW/MEDIUM: analytic Fresnel rim on a slightly larger back-face sphere.
  float rim = pow(1.0 - abs(dot(viewDir, normal)), 3.0);
  Tint toward blue, brighten where it faces the sun, fade on the night side.
  This must cost almost nothing.

HIGH: same approach but with a cheap multi-sample scattering approximation,
  plus a subtle sunset reddening near the terminator.

Also add a postprocessing stack: bloom (threshold tuned so only city lights
and pins bloom, not the whole day side), ACES tonemapping, and a light vignette.
Bloom is disabled on LOW.

Budget check: tell me the measured frame cost of the HIGH path versus LOW on
my machine, and add a dev overlay showing frame time.

Do not add volumetric clouds or god rays. Out of scope.
```

### Prompt 1.4 — Camera **[PLAN FIRST]**

```
This is the most important prompt in Phase 1. The camera feel decides whether
the product works. Read CLAUDE.md constraint 3 before you start.

Build src/globe/camera/OrbitGlobeControls.ts. Do NOT use drei's OrbitControls;
we need behaviour it does not provide.

Requirements:

1. Drag to rotate. Rotation speed scales with camera altitude:
   panSpeed = base * (altitude / EARTH_RADIUS)
   At world view a drag spins continents. At city view the same drag moves
   a few kilometres. This is non-negotiable and is the single biggest feel bug
   in globe UIs.

2. Flick inertia. On pointer-up, carry angular velocity and decay it:
   omega *= Math.exp(-friction * dt)
   Stop below a threshold. Friction tuned so a hard flick spins for about
   2-3 seconds.

3. Pinch and wheel zoom, zooming toward the pointer/pinch midpoint, not the
   screen centre. Unproject to a ray, intersect the sphere, keep that surface
   point under the pointer while altitude changes.

4. Quaternions throughout. No Euler angles. Clamp pitch so we never flip
   over the poles.

5. flyTo(lat, lon, altitude, options): parabolic arc where the camera rises,
   translates along a great circle, then descends. Duration scales with
   angular distance, clamped to 800ms-3000ms. Ease-in-out cubic. Returns a
   promise. Cancellable by user input.

6. All smoothing frame-rate independent, per CLAUDE.md.

7. Expose getState() / setState() so we can save and restore camera pose when
   entering and leaving the discussion panel later.

Write unit tests for the math: altitude scaling, great-circle interpolation,
flyTo duration curve.

Verification: a dev page with buttons that flyTo five named cities, plus an
overlay showing altitude, lat, lon, and current angular velocity. Then tell me
what to check by hand to confirm the feel is right.
```

### Prompt 1.5 — Instanced pins

```
Build the news pin renderer in src/globe/pins/.

- ONE InstancedMesh for all pins. Billboarded quads facing the camera.
- Signed-distance-field shader for a crisp glowing dot with a soft halo.
  Additive blending on the halo.
- Per-instance attributes: position, colour (by category), scale, alpha,
  pulse phase, pulse rate.
- Pulse: newer stories pulse faster and brighter.
  scale = base * (1.0 + 0.15 * sin(time * rate + phase) * recency)
- Horizon culling: hide pins on the far side of the globe. Cull when
  dot(normalize(P - center), normalize(camera - center)) < R / |camera - center|
  Fade over a small band rather than popping.
- An updateInstances(nodes: NodeBuffer) method that takes typed arrays and
  writes attributes in one pass. No per-pin object allocation in the loop.

Feed it 3000 mock pins with random positions and timestamps.

Acceptance: 3000 pins at 60fps on desktop and 30fps+ on a mid-range Android.
Report the measured numbers. If you cannot hit them, stop and tell me why
before optimizing blindly.
```

**Checkpoint.** Before Phase 2, show the globe to ten people with no explanation. If fewer than seven start spinning and zooming on their own, fix the interaction before adding data.

---

## PHASE 2 — Real data

### Prompt 2.1 — Database

```
Set up Supabase.

Write supabase/migrations/ with the full schema from docs/DATA_SCHEMA.md
(I will paste it below this message).

Requirements:
- PostGIS enabled, GIST index on the geography column
- Row-level security on EVERY table, with policies written explicitly
- Anonymous read on stories and articles only
- Nothing else readable or writable without auth
- Seed script that inserts 200 realistic fake stories spread across the globe
  and across the last 24 hours

Also write src/core/db/types.ts generated from the schema, and a typed
Supabase client in src/core/db/client.ts using only the anon key.

Verification: commands to apply migrations, run the seed, and query it back.
```

_(Paste the schema block from the build plan below this prompt.)_

### Prompt 2.2 — Ingest worker **[PLAN FIRST]**

```
Build the news ingest worker in workers/ingest/.

Cloudflare Worker on a 15-minute cron trigger.

Pipeline:
1. Pull recent articles from GDELT 2.0. Use the GEO 2.0 API endpoint which
   returns GeoJSON with coordinates already attached, falling back to the GKG
   file feed if needed. IMPORTANT: verify the current endpoint shape by
   fetching it and inspecting the real response before writing the parser.
   Do not write the parser from assumptions about the format.
2. Normalize into our Article shape.
3. Deduplicate:
   - canonical URL (strip UTM and tracking params, resolve redirects)
   - near-duplicate titles via a 64-bit simhash over title trigrams, Hamming
     distance threshold 3
   - group articles about the same event into one story
4. Compute heat 0-255 from: number of distinct sources, diversity of source
   countries, and publish velocity in the last hour. Document the formula in
   docs/DECISIONS.md.
5. Assign a category from GDELT themes to our fixed category list.
6. Upsert into Supabase using the service key (Worker secret, never client).
7. Mark stories crossing the heat threshold as discussion_state='queued'.
8. Delete stories older than 48 hours.

Include structured logging and a manual trigger route protected by a secret
so I can run it on demand.

Write tests for dedup and heat scoring with fixture data.

Do NOT geocode anything yourself in this prompt. GDELT gives us coordinates.
Gaps get skipped and logged for now.
```

### Prompt 2.3 — Payload API

```
Build the client payload endpoint in workers/api/.

GET /api/nodes?hours=24

Returns the columnar JSON described in docs/DATA_SCHEMA.md:
- int16 fixed-point lat/lon (lonQ = round(lon / 180 * 32767))
- t as seconds offset from the window start
- category as an index into a fixed array
- headline and place name inline; everything else loads on demand

Requirements:
- Brotli compression
- Cloudflare edge cache, 60 second TTL, with stale-while-revalidate
- Under 150KB compressed for 3000 nodes. Measure it and report the actual
  number. If it is over, tell me before trying to fix it.
- ETag support

Also GET /api/story/:id returning the full node: summary, all articles with
outlet and headline and URL, place provenance, and discussion state.

On the client, write src/core/data/nodes.ts that fetches the payload and
decodes it straight into typed arrays (Float32Array for positions,
Int32Array for timestamps). No intermediate object array. This feeds the
pin renderer directly.

Wire it up so the globe now shows real news.
```

---

## PHASE 3 — Navigation, clustering, scrubber

### Prompt 3.1 — Clustering and bloom **[PLAN FIRST]**

```
Add clustering with the signature expand animation.

1. Integrate supercluster. Cluster in screen space with a 44px radius.
   Recluster on zoom change, debounced. Run it in a Web Worker so it never
   blocks the render loop.

2. Cluster pins render as a larger orb with a count badge and a colour
   derived from the dominant category of its children.

3. THE BLOOM. When the user zooms past a cluster's expansion zoom, children
   do not appear instantly. They spiral outward from the cluster centre using
   phyllotaxis:
     angle = i * 137.507 degrees
     radius = c * sqrt(i)
   Each child is staggered by i * 18ms and settles with a critically damped
   spring (no overshoot). Total animation under 600ms even for 100 children.
   Zooming back out reverses along the same paths.

4. Node identity must be stable across cluster transitions. Key render slots
   by story id, never by array index. Nothing should flicker, pop, or swap
   positions.

Acceptance: expand a 120-node cluster and hold 60fps throughout the animation.
Report measured frame times during the bloom.
```

### Prompt 3.2 — Time scrubber

```
Build the time scrubber. This is our headline feature; it must feel instant.

- A slider along the bottom, 24 hours of range, snapping to "now" at the right
  edge with a magnet.
- Dragging it does ZERO network calls. All 24 hours are already in memory in
  typed arrays.
- Three things update together as it moves:
  1. Pin visibility and brightness. A pin appears at its publish time, is
     brightest for ~30 minutes, then fades over the following hours.
  2. The sun direction, so the day/night terminator rolls backward with the
     news. Drive this through the store value from prompt 1.2.
  3. A time label showing both UTC and the user's local time.
- Add a play button that animates the last 24 hours in about 20 seconds.
  This is the thing people will screenshot; make it look good.
- Releasing snaps back to live with a short eased transition.

History depth must be a config value (HISTORY_HOURS), not a literal 24
anywhere in the code.

Acceptance: 60fps while dragging with 3000 nodes loaded. Measure and report.
```

### Prompt 3.3 — Story UI

```
Build the news reading UI in src/ui/.

1. Peek card: slides up a third of the screen on pin tap. Headline, outlet,
   time ago, place name, "covered by N sources", and three actions
   (Save, Share, Discuss). The globe stays interactive above it. Swipe down
   dismisses.

2. Full node sheet: swipe up expands to 90%. Shows the summary, every article
   grouped by outlet with external links, a "Why this location" line showing
   place_name and place_source in plain language plus a "report wrong location"
   link, and related nearby stories.

3. Discuss button: enabled with a live participant count when discussion_state
   is 'open', otherwise greyed with "Discussion not open yet". Never hidden.

4. Share: copies a URL that encodes the camera position, the story id, and the
   scrubber time, so the recipient opens on exactly the same view. Implement
   the URL encode/decode in src/core/permalink.ts with tests.

All sheets: spring animation, critically damped, 320ms. Full keyboard
navigation and ARIA labels as you build, not after.
```

### Prompt 3.4 — Following, search, filters

```
Add the secondary navigation.

1. Search: place names, topics, and outlets. Selecting a place flies the
   camera there. Debounced, keyboard navigable, results under 150ms.

2. Filters: category chips and a time window. Non-matching pins dim and shrink
   rather than disappearing, so the globe never goes dark. Filter state lives
   in the URL.

3. Following tab: the ONLY conventional feed in the app. Chronological, finite,
   no infinite scroll. Users follow places, categories, and individual stories.
   Store follows in Supabase for signed-in users, localStorage for guests, and
   migrate localStorage follows up on sign-in.

4. Saved list: same guest-to-account migration.

5. Onboarding: after ~60 seconds of use or on first save, a three-step sheet
   asking for interests, home city (sets the camera resting position), and
   notification opt-in. Skippable. No sign-in required, no location permission
   requested.
```

**Ship this publicly.** This is a complete product. Get the audience before building discussions.

---

## PHASE 4 — Global Agora

### Prompt 4.1 — Auth and profiles

```
Add authentication with Supabase Auth.

- Sign in with Google, Apple, and email magic link
- On first sign-in, a required flow: age confirmation (17+), handle selection
  with three generated suggestions, and a community rules screen with an
  ACTIVE "I agree" button that writes rules_accepted_at. This is an App Store
  requirement for apps with user content; the agreement must be explicit.
- Guest data (follows, saved, interests) migrates on sign-in with nothing lost
- Account deletion that actually deletes, reachable from settings in under
  three taps
- Auth is required only for posting, voting, following, and saving.
  Reading stays fully anonymous.

RLS policies for profiles. Users can read any profile's public fields and
write only their own.
```

### Prompt 4.2 — Discussion backend **[PLAN FIRST]**

```
Build the discussion layer backend.

Tables from docs/DATA_SCHEMA.md: discussions, posts, votes, reports, blocks.
Every table gets RLS. Be strict:
- posts readable when mod_state='ok' and the author is not blocked by the reader
- posts insertable only by authenticated users with rules_accepted_at set,
  into discussions where state='open'
- votes insertable once per user per post per kind
- nobody can read the reports table except service role

Post shape:
- body, max 500 chars, enforced by CHECK constraint AND in the UI
- stance: 'a' | 'b' | 'neutral'
- kind: 'argument' | 'eyewitness' | 'evidence' | 'expert'
- evidence_url required when kind='evidence'
- kind='expert' gets NO ranking boost and is always rendered with an
  "unverified" label. Enforce the no-boost rule in the ranking function itself,
  not just the UI.

Ranking, recomputed by trigger on vote insert:
  cross_side_ratio = cross_side_count / greatest(helpful_count, 1)
  rank_score = ln(1 + helpful_count) * (0.5 + cross_side_ratio)
             + 1.5 * ln(1 + changed_mind_count)
cross_side_count increments only when the voter's stance differs from the
post's stance. Write SQL tests proving a one-sided popular post ranks below
a cross-side moderate one.

Auto-close discussions 48 hours after opening via pg_cron.
```

### Prompt 4.3 — Moderation pipeline

```
Build the moderation pipeline. Nothing in Phase 4 ships without this.

Supabase Edge Function on post insert:
1. Call OpenAI's omni-moderation endpoint (free). Store the full score object
   in mod_scores.
2. Call Google Perspective API for toxicity, severe toxicity, identity attack,
   and threat.
3. Decision:
   - Any OpenAI category flagged, or Perspective severe_toxicity > 0.85:
     mod_state='removed', never publicly visible, author gets a strike
   - Perspective toxicity 0.65-0.85: mod_state='hidden'. Visible to the author
     only, queued for human review.
   - Otherwise mod_state='ok'
4. Thresholds must be config values, not literals. I will tune them.

Also build:
- Report button on every post with reasons: harassment, hate, threat, spam,
  false expertise claim, off-topic. Reporter gets an outcome notification.
- Block: hides that user's content everywhere, both directions.
- Rate limiting: max 5 posts per hour per user, max 1 post per 30 seconds.
  New accounts under 24 hours old are capped at 2 posts per hour.
- An admin moderation queue page showing hidden and reported posts with
  approve / remove / strike actions.
- Three strikes suspends the account.

Write tests using known-toxic sample strings to prove the pipeline blocks them.
Do not skip this; the whole compliance story rests on it.
```

### Prompt 4.4 — Local badge

```
Implement the local badge. Read CLAUDE.md constraint 5 first.

- NO GPS. No geolocation permission prompt. No coordinates stored anywhere.
- Posts are submitted through a Cloudflare Worker route. The Worker reads
  request.cf.city and request.cf.country and, if the user has the badge
  toggled on for that post, writes a TEXT label like "Bengaluru area" into
  posts.region_label. Nothing else is captured.
- The badge NEVER affects rank_score. Assert this in a test.
- Per-post toggle, default off, with one line of copy explaining it uses
  approximate network location and can be wrong.
- The privacy policy text must describe this accurately.

If request.cf.city is unavailable, the label is null and the toggle is
disabled with an explanation. Do not fall back to any other location source.
```

### Prompt 4.5 — Discussion UI **[PLAN FIRST]**

```
Build the discussion experience. This is the transition users will judge us on.

ENTERING (all one coordinated motion, 600ms, ease-in-out cubic):
- Camera dollies down and locks onto the story's city, then slowly orbits it
- Globe desaturates and blurs; a depth-of-field effect pushes it back
- Globe drops to half resolution and 30fps
- Discussion panel slides up over the bottom two-thirds on phone,
  right side on tablet and desktop
- Camera pose is saved before the transition via the getState() from prompt 1.4

INSIDE:
- The debate prompt and the two side labels at the top
- A stance selector the user must pick before the composer unlocks
- Composer: 500 char counter, kind selector (Argument / Eyewitness /
  Evidence / Expert), URL field appearing only for Evidence, local badge toggle
- Posts sorted by rank_score. Each shows stance colour, kind chip, region label
  if present, body, helpful count, and "changed my mind" count
- "Expert" posts render with a visible "self-declared, unverified" label
- Two actions per post: Helpful and Changed my mind. They are visually distinct;
  Changed my mind is the prominent one.
- Realtime new posts via Supabase Realtime, appearing with a subtle highlight,
  never jumping the scroll position
- A "where the room stands" strip: proportion of posts per stance and the
  three highest cross-side posts

LEAVING:
- Reverse the transition, restore the exact saved camera pose, globe returns
  to full quality

Drag the panel down partway to peek at the globe, all the way to exit.

Acceptance: 60fps in the panel, 30fps globe behind, and no dropped frames
during either transition. Measure and report.
```

### Prompt 4.6 — Admin curation

```
Build the admin console at /admin, protected by a role check in RLS.

1. Hot story queue: stories with discussion_state='queued', sorted by heat,
   showing headline, source count, place, and heat score.
2. One-click open: generates a suggested debate prompt and two side labels
   from the story using an LLM call, shows them in editable fields, and on
   confirm creates the discussion with a 48-hour close time.
3. A hard cap: refuse to open more than 25 discussions at once, with a clear
   message. This cap is the thing that keeps moderation survivable.
4. Moderation queue from prompt 4.3.
5. A location correction tool: fix a story's coordinates by clicking a map.
6. Basic counters: open discussions, posts today, reports open, median time
   to action a report.

Nothing here needs to be pretty. It needs to be fast to use at 8am.
```

---

## PHASE 5 — Hardening

### Prompt 5.1 — Accessibility

```
Make the app fully usable without the globe.

1. A list view toggle: the same stories as a keyboard-navigable, screen-reader-
   friendly list with place, time, and source. Every story reachable on the
   globe must be reachable here. This is not a degraded mode; it is a first-class
   view.
2. Respect prefers-reduced-motion: no camera flights, no inertia, no pulsing,
   no bloom animation. Switch to a flat 2D equirectangular map.
3. Full keyboard navigation of the globe: arrow keys rotate, +/- zoom,
   Tab cycles visible pins, Enter opens.
4. Focus management on every sheet and panel. Focus traps where appropriate,
   focus restoration on close.
5. Audit every colour pair for WCAG AA. Never encode meaning in colour alone;
   every category needs a shape or label too.

Run axe-core in CI and fail the build on violations.
```

### Prompt 5.2 — Production readiness

```
Get us ready for an invite-only alpha.

1. PWA: manifest, service worker, offline shell. Cached stories readable
   offline with an honest "showing news from N hours ago" banner.
2. Sentry with source maps, plus a WebGL context-loss handler that recovers
   rather than white-screening.
3. Performance budgets in CI: bundle size, Lighthouse score, payload size.
   Fail the build on regression.
4. Legal pages: terms, privacy (describing the IP-derived region label
   accurately), community rules, and a contact route that reaches a real
   inbox. Link them in-app, not just in a footer.
5. An appeals form for suspended users.
6. Error and empty states everywhere: no data, offline, discussion closed,
   story deleted, WebGL unsupported.
7. Plausible or Umami analytics, self-hosted or free tier, tracking only:
   session length, stories opened, scrubber used, discussions entered,
   posts made, week-two return rate. Nothing personal.

Finish with a pre-launch checklist I can tick through.
```

---

## Where Claude in Chrome earns its keep

Use it for the things Claude Code cannot see. Keep it on localhost and public docs. Do not let it into your Supabase or Cloudflare dashboards; change settings there yourself.

**1. Verify the GDELT response before writing the parser.** Prompt 2.2 depends on the real response shape. Point Chrome at the GDELT API endpoint, have it read the actual JSON, and paste a real sample back into Claude Code. This single step prevents the most common failure in that phase, which is a parser written against an imagined format.

**2. Visual QA of the globe.** After prompts 1.2, 1.3, and 3.1, have Chrome open localhost, screenshot at several camera positions and times of day, and describe what looks wrong. It catches terminator seams, texture pinching at the poles, and bloom blowing out the day side.

**3. Responsive checks.** Have it resize to 390px, 768px, and 1440px and screenshot the discussion panel at each. This is faster than doing it by hand and catches the tablet split-view bugs.

**4. Camera feel reference.** Have it open earth.nullschool.net and windy.com, interact with them, and describe the inertia and zoom behaviour in detail. Feed that description into prompt 1.4. Studying a reference beats describing feel from scratch.

**5. Post-deploy smoke test.** After each deploy, walk it through: load the site, spin the globe, open a story, drag the scrubber, open a discussion. Have it report anything broken.

---

## Session hygiene that actually matters

- **One prompt per session.** Merge two and quality drops noticeably.
- **Plan mode for anything marked [PLAN FIRST].** Read the plan properly. Rejecting a bad plan costs a minute; unwinding a bad implementation costs an evening.
- **Never accept "it should work."** Every prompt asks for a verification command. Run it.
- **When it reports a missed performance budget, believe it and stop.** The budgets exist because a beautiful globe nobody can run is worth nothing.
- **Update docs/DECISIONS.md as you go.** By Phase 4 you will not remember why you chose something in Phase 1, and neither will Claude Code.
- **Commit before every prompt.** You will want to roll one back.
