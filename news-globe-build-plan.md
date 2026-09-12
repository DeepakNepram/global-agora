# Global Agora — Final Build Plan (v1, Web)

Locked against your Section 11 answers. Everything here assumes: globe is primary navigation, one discussion per story, sided debates with contribution types, mid curation, easiest-safest local badge, time scrubber at launch, web first, monetization deferred but not blocked, discussions on hot stories only.

**The one-line pitch this plan is built to deliver:** browse the world's news on a living 3D Earth, scrub back through the last 24 hours to watch a story spread, and argue about it with people on the other side.

---

## 1. Stack decisions, with the tradeoff you are accepting

| Layer       | Choice                                                       | Cost                                  | Why this over the alternative                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Render      | **Three.js + react-three-fiber + drei + postprocessing**     | Free                                  | CesiumJS gives real terrain and fly-to for free but is ~3–4MB, opinionated, and hard to make cinematic. You want a stylized beautiful Earth, not a GIS viewer. Tradeoff: you write the camera and LOD yourself.                                  |
| Build       | **Vite + React 18 + TypeScript**                             | Free                                  | Fastest HMR, smallest config. Next.js would give SSR you don't need for a WebGL app.                                                                                                                                                             |
| State       | **Zustand**                                                  | Free                                  | Redux is overkill; Zustand plays well with r3f's render loop and avoids re-render storms.                                                                                                                                                        |
| Styling     | **Tailwind CSS**                                             | Free                                  | Fast, and Claude Code writes it reliably.                                                                                                                                                                                                        |
| Backend     | **Supabase** (Postgres + PostGIS + Auth + Realtime + RLS)    | Free tier, $25/mo when you outgrow it | One free tier replaces four services. Tradeoff: some vendor lock-in, and the free tier pauses inactive projects. Firebase is the alternative but Postgres + PostGIS is the right shape for geo data.                                             |
| Ingest      | **Cloudflare Workers + Cron Triggers**                       | Free tier                             | Runs every 15 minutes for nothing. Alternative: GitHub Actions cron (free but slower to start, 5-min minimum) or Supabase pg_cron (fine, but ties ingest to your DB).                                                                            |
| Hosting     | **Cloudflare Pages**                                         | Free                                  | Vercel Hobby also works. Pages keeps everything on one account with the Workers and gives you the IP-city header you need for the local badge.                                                                                                   |
| News data   | **GDELT 2.0** (GEO/GKG endpoints)                            | **Free**                              | It already returns latitude and longitude, which deletes your entire geoparsing problem for v1. Paid alternatives start around $90–450/month and still don't geocode. Tradeoff: no SLA, occasionally wrong locations, English-heavy in practice. |
| Backup data | RSS feeds via the same worker                                | Free                                  | Fills gaps GDELT misses. Needs your own geo-tagging, so keep it to a curated list of ~50 outlets.                                                                                                                                                |
| Geocoding   | GDELT's own coordinates, with **Nominatim** for the few gaps | Free                                  | Cache every lookup. Public Nominatim allows roughly 1 request/second, which is fine if you cache by place name.                                                                                                                                  |
| Moderation  | **OpenAI omni-moderation** + **Perspective API**             | Free                                  | Both have free access. Two layers because they catch different things.                                                                                                                                                                           |
| Realtime    | **Supabase Realtime**                                        | Included                              | Already paid for. Pusher/Ably are better at scale but cost money you don't need to spend yet.                                                                                                                                                    |
| Errors      | **Sentry** free tier                                         | Free                                  | You will need it the first time the globe white-screens on someone's Android.                                                                                                                                                                    |
| Textures    | NASA Blue Marble + Black Marble, Natural Earth               | Free, public domain                   | No licensing risk.                                                                                                                                                                                                                               |

**Total prototype cost: effectively $0/month plus about $12/year for a domain.** First real bill arrives when you cross Supabase's free tier, realistically around $25–60/month at early-alpha scale. Verify all free-tier limits at build time; they change.

---

## 2. Decisions your answers force, spelled out

### Time scrubber at launch changes the architecture

This is the biggest consequence of your answers. Because the scrubber ships in v1, you cannot design a "show me now" API and bolt history on later.

**The design:** the client loads the **entire last 24 hours** of story nodes on startup, as one compact columnar payload, and holds it in typed arrays. The scrubber is then pure client-side filtering with zero network calls, which is why it will feel instant. Target under 150KB compressed for roughly 2,000–3,000 nodes.

When the scrubber moves, three things update together: which pins are visible, how bright they are (recent = bright), and the sun position, so the day/night line rolls backward with the news. That combined motion is the thing people will screenshot.

Cap history at 24 hours in v1. The paywall you'll want later is "7 days of history," so build the depth as a config value, not a hardcoded number.

### Sided debate with four contribution types

Every post has two independent tags:

- **Stance:** Side A / Side B / Neutral
- **Kind:** Argument / Eyewitness / Evidence / Expert

**Eyewitness** and **Evidence** are safe. Evidence requires a URL and shows it as a chip.

**Expert is the risky one.** You cannot verify credentials in v1. The safest version that still ships: the user self-declares, the post is labeled **"self-declared expertise, unverified"** in plain language, and it gets **no ranking boost whatsoever**. Add "falsely claiming expertise" as a report reason. If that feels too weak, the alternative is to hold Expert back until you have a manual verification queue, which is real ongoing work.

### Local badge, easiest and safest version

Do **not** ask for GPS. Do not store coordinates.

Cloudflare gives you an approximate city on every request for free, derived from IP. At the moment a post is created, the worker reads that and writes a **text label only** onto the post: "posting from Bengaluru area." Nothing else is stored, nothing is linked across posts, no permission prompt appears, and there is no precise location anywhere in your database.

The badge **never** affects ranking. It is a label so readers can weigh it themselves. Users can turn it off per post. VPN users will show the wrong city, which is fine and is exactly why it must not carry ranking weight.

### Hot stories only

A story's discussion opens when it clears a heat threshold **and** a human confirms it. That is your "mid curation."

Heat is computed in the ingest worker from source count, source diversity, and velocity in the last hour. Anything above the threshold lands in an admin queue. You open it with one click, which also generates the debate prompt and the two side labels for you to edit. Target roughly 10–25 open discussions at any time. Every other story shows a greyed "Discussion not open" state, which is honest and avoids the dead-room problem.

### Monetization hooks without building a paywall

Add these in v1 and use none of them:

- `profiles.tier` column, defaults to `free`
- A `feature_flags` table read at startup
- History depth, saved-story limit, and alert count all read from config, never hardcoded

That's the whole cost of keeping the door open.

### Mobile-app readiness rules, from day one

Follow these and the later port is a port, not a rewrite:

1. All globe code lives in `src/globe/` and talks to the app through one interface. No React-specific code below that boundary except the r3f wrapper.
2. All data fetching and models live in `src/core/`, framework-agnostic, no DOM.
3. Touch-first. No hover-only affordances anywhere.
4. Ship as an installable PWA from v1.
5. Test on a real mid-range Android every single phase, not at the end.

---

## 3. Data model

```sql
-- Deduplicated news events. One row = one pin on the globe.
create table stories (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  summary       text,
  category      smallint not null,              -- index into a fixed category list
  lat           double precision not null,
  lon           double precision not null,
  geog          geography(Point,4326) generated always as
                  (ST_MakePoint(lon, lat)::geography) stored,
  place_name    text,
  place_source  text,                           -- 'gdelt' | 'dateline' | 'manual'
  place_conf    smallint,                       -- 0-100, shown as "why this location"
  country_code  char(2),
  heat          smallint default 0,             -- 0-255
  sentiment     smallint default 0,             -- -100..100
  source_count  smallint default 1,
  published_at  timestamptz not null,
  first_seen_at timestamptz default now(),
  title_hash    bigint,                         -- for near-duplicate detection
  discussion_state text default 'none'          -- none | queued | open | closed
);
create index on stories using gist (geog);
create index on stories (published_at desc);
create index on stories (heat desc) where discussion_state = 'queued';

-- One row per outlet covering a story. Powers "covered by 12 sources".
create table articles (
  id           uuid primary key default gen_random_uuid(),
  story_id     uuid references stories(id) on delete cascade,
  url          text unique not null,
  outlet       text,
  outlet_country char(2),
  headline     text not null,
  snippet      text,
  image_url    text,
  published_at timestamptz,
  lang         char(2)
);

-- Opened manually from the admin queue.
create table discussions (
  story_id     uuid primary key references stories(id) on delete cascade,
  prompt       text not null,
  side_a_label text not null,
  side_b_label text not null,
  opened_at    timestamptz default now(),
  closes_at    timestamptz not null,            -- typically opened_at + 48h
  state        text default 'open',             -- open | closed
  post_count   int default 0
);

create table posts (
  id            uuid primary key default gen_random_uuid(),
  story_id      uuid references discussions(story_id) on delete cascade,
  author_id     uuid references profiles(id),
  body          text not null check (char_length(body) between 1 and 500),
  stance        text not null check (stance in ('a','b','neutral')),
  kind          text not null check (kind in ('argument','eyewitness','evidence','expert')),
  evidence_url  text,                            -- required when kind = 'evidence'
  region_label  text,                            -- coarse city text from IP, or null
  mod_state     text default 'pending',          -- pending | ok | hidden | removed
  mod_scores    jsonb,
  helpful_count      int default 0,
  cross_side_count   int default 0,
  changed_mind_count int default 0,
  rank_score    real default 0,
  created_at    timestamptz default now()
);

create table votes (
  post_id      uuid references posts(id) on delete cascade,
  voter_id     uuid references profiles(id),
  kind         text check (kind in ('helpful','changed_mind')),
  voter_stance text,                             -- captured at vote time
  created_at   timestamptz default now(),
  primary key (post_id, voter_id, kind)
);

create table reports (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid references posts(id) on delete cascade,
  reporter_id uuid references profiles(id),
  reason     text not null,
  state      text default 'open',                -- open | actioned | dismissed
  created_at timestamptz default now()
);

create table blocks (
  blocker_id uuid references profiles(id),
  blocked_id uuid references profiles(id),
  primary key (blocker_id, blocked_id)
);

create table profiles (
  id            uuid primary key references auth.users(id),
  handle        text unique not null,
  display_name  text,
  tier          text default 'free',             -- monetization hook, unused in v1
  trust_level   smallint default 0,
  rules_accepted_at timestamptz,
  is_adult      boolean default false,
  strikes       smallint default 0,
  created_at    timestamptz default now()
);
```

**Ranking, v1.** No machine learning. One formula, recomputed on vote:

```
cross_side_ratio = cross_side_count / greatest(helpful_count, 1)
rank_score = ln(1 + helpful_count) * (0.5 + cross_side_ratio)
           + 1.5 * ln(1 + changed_mind_count)
```

`cross_side_count` increments only when the voter's stance differs from the post's stance. A post loved by one side and ignored by the other ranks below a post that both sides found useful. This is the cheap version of bridging ranking and it works from the first hundred votes. Proper matrix factorization needs volume you won't have.

**Client payload** (one request on load, covers the whole scrubber window):

```json
{
  "v": 1,
  "generated_at": 1757560800,
  "window_hours": 24,
  "categories": [
    "world",
    "conflict",
    "politics",
    "business",
    "science",
    "climate",
    "tech",
    "health"
  ],
  "nodes": {
    "id": ["a1b2c3", "d4e5f6"],
    "lonQ": [12043, -7421],
    "latQ": [8891, 15220],
    "t": [0, 3480],
    "cat": [1, 3],
    "heat": [220, 15],
    "srcN": [12, 1],
    "disc": [1, 0],
    "hl": ["Quake hits central...", "Vote nears in..."],
    "pl": ["Ankara, Türkiye", "Brussels, Belgium"]
  }
}
```

`lonQ`/`latQ` are int16 fixed-point (about 550m precision, more than enough for a city pin). `t` is seconds since `generated_at - window_hours`. `disc` is 1 when a discussion is open. Everything else loads on tap.

---

## 4. The build, in five phases

Estimates assume one developer working with Claude Code, roughly 20–25 focused hours a week. Add 30–50% if that's optimistic for you, which it usually is.

### Phase 0 — Foundations (2–3 days)

Repo, tooling, CLAUDE.md, Supabase project, Cloudflare account, texture assets downloaded.
**Done when:** `npm run dev` shows a blank canvas, `npm run typecheck` and `npm run test` both pass, and CI runs on push.

### Phase 1 — The Globe (2–3 weeks)

Sphere, day/night textures, real sun position, terminator shader, atmosphere, camera with inertia and altitude-scaled panning, fly-to, quality tiers, FPS overlay, mock pins.
**Done when:** 60fps on desktop, 30fps or better on a mid-range Android in Chrome, cold start to interactive under 2 seconds, and spinning it feels good enough that you want to keep doing it. That last one is a real acceptance criterion. If the spin feels wrong, stop and fix it before moving on.

### Phase 2 — Real data (1.5–2 weeks)

Supabase schema, Cloudflare cron worker pulling GDELT every 15 minutes, deduplication, heat scoring, the columnar payload endpoint with edge caching.
**Done when:** real news appears on the globe within 20 minutes of publication, the payload is under 150KB compressed, and p95 response time is under 200ms.

### Phase 3 — Navigation, clustering, scrubber (2–2.5 weeks)

Supercluster, the cluster bloom animation, time scrubber wired to both pins and sun, peek card, full node sheet with all sources and "why this location," search, filters, Following tab, saved list.
**Done when:** the full read-only product works end to end and the scrubber runs at 60fps while dragging.

**This is your first shareable milestone.** Ship it publicly. A read-only news globe with a time scrubber is already a product, and it gives you the audience you need before discussions can work.

### Phase 4 — Global Agora (3–4 weeks)

Auth with age gate and rules acceptance, discussion tables with row-level security, realtime posts, stance and kind tags, cross-side ranking, moderation pipeline, report and block, local badge, admin queue for opening discussions.
**Done when:** the full report-to-removal loop works with a human in it, abusive test content is blocked before it posts, and you can open a discussion from the admin queue in one click.

### Phase 5 — Hardening and alpha (2 weeks)

Accessibility (list view, reduce motion, 2D fallback map), PWA, Sentry, legal pages, contact route, appeals, seeding plan, invite-only alpha.
**Done when:** the app is usable entirely by keyboard and screen reader, and you have the full user-content compliance checklist ticked.

**Total: roughly 11–14 weeks solo.** Plan for 16–18.

---

## 5. Go/no-go gates

Do not skip these. Each one is a place where stopping is cheaper than continuing.

**After Phase 1.** Show the globe to ten people cold. If fewer than seven spontaneously start spinning and zooming without instruction, the interaction model is wrong and no amount of data fixes it.

**After Phase 3.** Ship publicly. Watch week-two return rate. If almost nobody comes back a second week, adding discussions will not save it. Fix the news experience first.

**Before Phase 4.** You need a seeding plan on paper: who is going to be in the first rooms, and why. Ten open discussions with three real people each beats a hundred empty ones. If you cannot answer this, delay Phase 4 and keep improving the globe.

---

## 6. Risks, honestly

| Risk                         | Likelihood    | What it looks like                                | Mitigation                                                                                             |
| ---------------------------- | ------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Empty discussion rooms       | High          | Discuss buttons show 0, users stop tapping them   | Hot stories only, seed manually, ship Phase 3 publicly first                                           |
| GDELT location errors        | Certain       | A story about Georgia the country pins in Atlanta | "Why this location" line plus a report-wrong-location link; correct manually for hot stories           |
| Mobile web performance       | Moderate–high | Stutter and heat on mid-range Android             | Quality tiers from Phase 1, test on real hardware every phase, render-on-demand                        |
| Moderation workload          | Moderate      | You personally reviewing reports at 11pm          | Auto-block the obvious, cap open discussions at ~25, close after 48h                                   |
| Supabase free tier limits    | Moderate      | Project pauses or hits bandwidth caps             | Cache aggressively at the edge, budget $25/mo from alpha                                               |
| Scope creep into native apps | High          | Three months of port work before web is proven    | The mobile-readiness rules in section 2, and a hard rule: no native work until web retention is proven |
| You burn out on the globe    | Real          | Two months of shader tuning, no product           | Phase 1 has a hard 3-week cap. Ship ugly if you must, then improve.                                    |

---

## 7. Compliance checklist before any public launch with discussions

- [ ] Community rules screen with an active "I agree"
- [ ] Automatic filtering before content posts
- [ ] Report button on every post
- [ ] Block button on every user
- [ ] Published contact email in-app and on the site
- [ ] A real process to action reports within 24 hours
- [ ] Appeals route
- [ ] Age gate
- [ ] Working account deletion
- [ ] Privacy policy that accurately describes the IP-derived region label
- [ ] For EU users: a reason given for every removal, and a route to contest it

The first five are what get an app rejected. The rest is what keeps you out of trouble afterwards.
