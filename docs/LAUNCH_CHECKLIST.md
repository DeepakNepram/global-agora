# Launch checklist: the invite-only alpha

Tick these in order. Each section depends on the ones above it. Commands run
from the repository root.

**Never paste a key, secret or password into a chat, an issue or a commit.**
Every secret below goes in through a prompt (`wrangler secret put`,
`supabase link`), a dashboard, or a gitignored file you edit yourself.

## 1. Accounts

- [ ] **Supabase** (free plan is enough for the alpha).
- [ ] **Cloudflare**, on the **Workers Paid** plan ($5 a month): an ingest run
      takes 80–280 ms of CPU, and the free plan allows 10 ms.
- [ ] **A domain on Cloudflare** (recommended). The API's edge cache only
      works on your own domain, not on `*.workers.dev`. Without one, see
      "No domain" in section 5.
- [ ] **Sentry**, free Developer plan: a Browser JavaScript project.
- [ ] **Umami Cloud**, free Hobby plan (100,000 events a month): add the site
      by its domain.
- [ ] **A real inbox** for the Contact page, the policies and appeals.
- [ ] **An email-sending service** for sign-in mail (Resend, Brevo, …).
      Supabase's own sender only mails your project's team, 2 an hour.
- [ ] **OpenAI** (moderation; the moderation endpoint is free).
- [ ] **Google Cloud:** the Cloud Natural Language API with billing on (the
      second moderation check), and an OAuth client if you offer Google
      sign-in.
- [ ] **Anthropic** (the admin console's debate suggestions; optional, you
      can type them yourself).
- [ ] **Apple Developer Program** ($99 a year), only to offer Apple sign-in.
      Leave `apple` out of `VITE_AUTH_PROVIDERS` to skip it.

## 2. Legal review (before any invitation)

The pages are drafts written against the code, not legal advice.

- [ ] Someone qualified reads `/terms`, `/privacy`, `/rules` and `/about`
      (source: `src/core/legal/`, `src/core/privacyPolicy.ts`,
      `src/core/communityRules.ts`).
- [ ] **Age: 17+ or 18+.** If you run the service from India, the DPDP Act
      treats anyone under 18 as a child needing verifiable parental consent.
      Changing to 18+ is wording only (the database stores yes or no): the
      setup sheet (`SetupSheet.tsx`, `SetupSteps.tsx`), the terms, the rules
      and the privacy policy.
- [ ] The governing law follows `VITE_OPERATOR_COUNTRY`; check that the
      terms read right for your country.
- [ ] If any wording changes, update `LEGAL_UPDATED_AT` in
      `src/core/legal/site.ts`.

## 3. Supabase

- [ ] **Create the project.** Its region cannot change later. Write it the
      way the privacy policy should say it, for `VITE_DATA_REGION` (e.g.
      "the EU (Frankfurt)").
- [ ] **Push the schema** (prompts for the database password):

  ```bash
  npx supabase login
  npx supabase link --project-ref <your-project-ref>
  npx supabase db push --dry-run
  npx supabase db push
  ```

  The fictional seed stays out. Never run `db reset --linked`.

- [ ] **Auth → Sign In / Providers → User Signups: turn off "Allow new users
      to sign up".** This is what makes the alpha invite-only.
- [ ] **Auth → URL Configuration:** Site URL is your origin
      (`https://<your-domain>`); Redirect URLs has `https://<your-domain>/**`.
- [ ] **Auth → Emails:** your SMTP service, and paste both templates,
      `supabase/templates/magic_link.html` and `confirmation.html`.
- [ ] **Auth → Providers:** Google (client id and secret; its authorised
      redirect URI is `https://<ref>.supabase.co/auth/v1/callback`), Apple if
      offered. Only list what is set up in `VITE_AUTH_PROVIDERS`: an
      unconfigured provider gives a raw 400 page.
- [ ] **Project Settings → API:** `private` is **not** in Exposed schemas.
      Legacy API keys stay on (the moderation function needs
      `SUPABASE_SERVICE_ROLE_KEY`).
- [ ] **Project Settings → Realtime:** "Allow public access" stays on, or
      discussions stop updating live.
- [ ] **Edge Function secrets** (Project Settings → Edge Functions →
      Secrets): `OPENAI_API_KEY`, `GOOGLE_API_KEY` (restricted to the Natural
      Language API), `MODERATION_HOOK_SECRET` (a new long random value) and
      `ANTHROPIC_API_KEY`. Never the local values. Then:

  ```bash
  npx supabase functions deploy moderate-post
  ```

  ```bash
  npx supabase functions deploy suggest-debate
  ```

- [ ] **Vault**, in the SQL editor (without these, every post stays pending):

  ```sql
  select vault.create_secret('https://<ref>.supabase.co/functions/v1/moderate-post', 'moderation_function_url');
  select vault.create_secret('<the MODERATION_HOOK_SECRET value>', 'moderation_hook_secret');
  select vault.create_secret('<a new random value; the same goes in REGION_LABEL_SECRET>', 'region_label_secret');
  ```

## 4. Sentry

- [ ] **Project → Settings → Security & Privacy:** turn on "Prevent Storing
      of IP Addresses". The app already sends none; this makes sure.
- [ ] Copy the project's **DSN** for `VITE_SENTRY_DSN` (public by design).
- [ ] Create an **organization auth token** for source maps, and put it in a
      new gitignored file, `.env.sentry-build-plugin`:

  ```
  SENTRY_AUTH_TOKEN=<token>
  SENTRY_ORG=<org slug>
  SENTRY_PROJECT=<project slug>
  ```

  With this file present, `npm run build` uploads the source maps and fails
  if the upload does.

- [ ] Alerts: an email on each new issue.

## 5. Cloudflare

- [ ] `npx wrangler login`.
- [ ] **Ingest first**, so news builds up while you finish (the globe fills
      over 24 hours):

  ```bash
  npx wrangler deploy -c workers/ingest/wrangler.jsonc
  npx wrangler secret put SUPABASE_URL -c workers/ingest/wrangler.jsonc
  npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY -c workers/ingest/wrangler.jsonc
  npx wrangler secret put INGEST_TRIGGER_SECRET -c workers/ingest/wrangler.jsonc
  ```

  `SUPABASE_SERVICE_ROLE_KEY` is the project's secret key. Watch the first
  runs with `npx wrangler tail global-agora-ingest`.

- [ ] **The Pages project**, deployed by direct upload (the textures are
      gitignored, so a Git-connected build would have none):

  ```bash
  npx wrangler pages project create global-agora --production-branch main
  ```

  Then attach your domain to it in the dashboard.

- [ ] **The API Worker**, once the domain is attached. Add its route to
      `workers/api/wrangler.jsonc` (the commented `routes` line shows the
      shape), then:

  ```bash
  npx wrangler deploy -c workers/api/wrangler.jsonc
  npx wrangler secret put SUPABASE_URL -c workers/api/wrangler.jsonc
  npx wrangler secret put SUPABASE_ANON_KEY -c workers/api/wrangler.jsonc
  npx wrangler secret put REGION_LABEL_SECRET -c workers/api/wrangler.jsonc
  npx wrangler secret put UMAMI_WEBSITE_ID -c workers/api/wrangler.jsonc
  ```

  `SUPABASE_ANON_KEY` is the **publishable** key. `REGION_LABEL_SECRET` is
  the same value as the Vault's `region_label_secret`. `UMAMI_WEBSITE_ID` is
  in Umami under the site's settings.

- [ ] **No domain?** Set `API_ALLOWED_ORIGINS` to
      `https://global-agora.pages.dev` in `workers/api/wrangler.jsonc` (a
      dashboard value is reset by the next deploy), and
      `VITE_API_BASE_URL=https://global-agora-api.<subdomain>.workers.dev/api`
      in the build. There is no edge cache then, so more Supabase egress
      (5 GB a month on the free plan).

## 6. Build and deploy the app

- [ ] Create `.env.production.local` (gitignored) with:
      `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable),
      `VITE_AUTH_PROVIDERS`, `VITE_SENTRY_DSN`, `VITE_CONTACT_EMAIL`,
      `VITE_OPERATOR_NAME`, `VITE_OPERATOR_COUNTRY` and `VITE_DATA_REGION`
      (`.env.example` describes each). A key it leaves out comes from
      `.env.local`, the local stack's.
- [ ] `npm run textures`, if `public/textures` has no `.webp` files.
- [ ] `npm run deploy:check`: every line `ok`, except a warning you mean.
      It prints no values.
- [ ] Build, check the budgets, deploy:

  ```bash
  npm run build
  npm run budgets:bundle
  npx wrangler pages deploy dist --project-name global-agora --branch main
  ```

## 7. Smoke test, laptop and phone

- [ ] `curl https://<your-domain>/api/health` returns `{"ok":true}`.
- [ ] The payload is under 150 KB once the day has filled:
      `curl -s -o /dev/null -w "%{size_download}\n" -H "accept-encoding: br" "https://<your-domain>/api/nodes?hours=24"`.
- [ ] `curl -sI https://<your-domain>/` shows `content-security-policy` and
      `x-robots-tag: noindex`.
- [ ] The globe loads; a pin opens its story; the scrubber plays; the list
      and the flat map (reduced motion on) show the same stories.
- [ ] **Offline:** load the site, go offline, reload: the banner says
      "You're offline. Showing news from …", and saved stories open.
- [ ] **Install:** Chrome offers "Install"; on an iPhone, Share → Add to Home
      Screen.
- [ ] **Invite-only:** an address you have not added gets "Global Agora is
      invite-only for now" at sign-in.
- [ ] **Your own account:** add yourself (section 8), sign in by link and by
      code, finish setup, then make yourself an admin in the SQL editor:

  ```sql
  insert into public.admins (user_id) select id from public.profiles where handle = '<your handle>';
  ```

- [ ] If you offer Google sign-in: an added person signs in with Google
      under the same address and lands in the same account.
- [ ] **A discussion:** open one from `/admin`, post, and see the post come
      back approved within seconds; turn the local badge on for a post.
- [ ] **Appeals:** a second added account posts three times; report each
      post from your account, then "Remove and strike" each in
      `/admin/moderation`. The third strike suspends it. Appeal from its
      account sheet, grant it in `/admin/appeals`, and post again.
- [ ] **Account deletion:** a throwaway added account deletes itself from
      the account sheet, and is gone from Authentication → Users.
- [ ] **The documents:** `/about`, `/rules`, `/privacy`, `/terms`, `/contact`
      open as pages, and in the app from the header's About and the footer's
      links; the policy names your operator, country, data region and
      address.
- [ ] **The inbox:** mail sent from another account to the contact address
      arrives.
- [ ] **Sentry:** in the browser console, break date formatting with
      `Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', { get() { throw new Error('Sentry check') } })`,
      then move the scrubber. The crash screen appears (Reload clears it),
      and Sentry shows the issue with the app's own source lines, no IP
      address and no query strings.
- [ ] **Umami:** open a story; within a minute or two the site shows a
      `story_opened` event. Its visitor and location panels show our server
      (Cloudflare), never a reader: that is the design.
- [ ] **The phone performance run** deferred since 5.1 (30 fps on the
      Adreno 610 phone, cold start under 2 s): ask Claude to run it, after
      regenerating the LAN certificate.

## 8. Invite people

- [ ] **Authentication → Users → Add user → Create new user:** their email,
      a long random password they will never need (sign-in is by link or
      code), and "Auto Confirm User" ticked. Not "Send invitation": its link
      cannot finish the app's sign-in.
- [ ] Send them your own message, for example:

  > You're invited to the Global Agora alpha: world news on a globe, and
  > sided discussions on the biggest stories. Open https://<your-domain>
  > and sign in with this email address (<their address>). You'll get a
  > link or a code by email. It's an early version: tell us what breaks
  > at <contact address>. Please read the community rules before posting.

## 9. The first week

- [ ] **Sentry,** daily: new issues, and how often the "WebGL context lost"
      warnings come, by device.
- [ ] **The ingest Worker** runs every 15 minutes: `npx wrangler tail
global-agora-ingest`, or Workers Logs in the dashboard.
- [ ] **`/admin`:** the moderation queue, reports and appeals; a reply to
      each appeal.
- [ ] **Usage against free limits:** Supabase database size (500 MB) and
      egress (5 GB a month), Umami events (100,000 a month), OpenAI and
      Google Cloud billing.
- [ ] **Reading the counts:** browsers sending Global Privacy Control or Do
      Not Track, and readers who switched counting off, are not counted, so
      every number is a floor. Read event counts, not Umami's visitors,
      sessions or countries: every event reaches Umami from our server.
      Week-two return for a cohort is its `week_active` events with `week` 1
      over those with `week` 0 (Umami's event properties). A session's
      length is its `session_end` event's `duration` bucket.

## 10. Rolling back

- **The app:** Cloudflare dashboard → Workers & Pages → global-agora →
  Deployments → the previous one → Rollback. Navigations are network first,
  so readers get the old build on their next load; the service worker offers
  Reload to anyone with the page open.
- **A Worker:** `npx wrangler rollback -c workers/api/wrangler.jsonc` (or
  `workers/ingest/…`), or Deployments in the dashboard.
- **The database:** migrations go forward only. Undo with a new migration;
  take `npx supabase db dump -f <file>.sql` before each `db push`.
- **Counting off:** `npx wrangler secret delete UMAMI_WEBSITE_ID -c workers/api/wrangler.jsonc`
  (events are then accepted and dropped).
- **Crash reports off:** build without `VITE_SENTRY_DSN` and deploy.

## 11. At public launch (later, not for the alpha)

- [ ] Remove `X-Robots-Tag: noindex` from `public/_headers`, the check that
      expects it in `tests/e2e/platform.spec.ts`, and `is-crawlable` from
      `skipAudits` in `scripts/budgets/lighthouse.ts`.
- [ ] Turn sign-ups back on, and decide how a suspended reader who deletes
      the account is kept from signing up again (`docs/DATA_SCHEMA.md`, open
      questions).
- [ ] Replace the header's "Alpha" tag, and say so on `/about`.
- [ ] Apple sign-in's client secret expires every 6 months: renew it.

## Keys, by where they go

| Key                                                         | Where                                        | Secret? |
| ----------------------------------------------------------- | -------------------------------------------- | ------- |
| Database password                                           | `supabase link`'s prompt                     | yes     |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable) | `.env.production.local`                      | no      |
| `VITE_AUTH_PROVIDERS`, `VITE_CONTACT_EMAIL`                 | `.env.production.local`                      | no      |
| `VITE_OPERATOR_NAME`, `_COUNTRY`, `VITE_DATA_REGION`        | `.env.production.local`                      | no      |
| `VITE_SENTRY_DSN`                                           | `.env.production.local`                      | no      |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`         | `.env.sentry-build-plugin`                   | token   |
| Google OAuth client id and secret                           | Supabase Auth → Providers                    | yes     |
| Apple Services ID and signing key                           | Supabase Auth → Providers                    | yes     |
| SMTP credentials                                            | Supabase Auth → Emails                       | yes     |
| `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`     | Supabase Edge Function secrets               | yes     |
| `MODERATION_HOOK_SECRET`                                    | Edge Function secrets and Vault (same value) | yes     |
| `REGION_LABEL_SECRET`                                       | API Worker secret and Vault (same value)     | yes     |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`                         | API Worker secrets                           | no      |
| `UMAMI_WEBSITE_ID`                                          | API Worker secret                            | no      |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                 | Ingest Worker secrets                        | yes     |
| `INGEST_TRIGGER_SECRET`                                     | Ingest Worker secret                         | yes     |
