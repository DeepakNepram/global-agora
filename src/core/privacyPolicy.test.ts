import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ANALYTICS_EVENTS } from './analytics';
import { DEVICE_STORAGE } from './legal/privacySections';
import type { LegalSite } from './legal/types';
import { regionLabel } from './localBadge';
import { LOCAL_BADGE_POLICY, privacyDocument } from './privacyPolicy';

const SITE: LegalSite = {
  operator: 'Example Operator',
  country: 'India',
  contactEmail: 'hello@agora.example',
  dataRegion: 'the EU (Frankfurt)',
};
const POLICY = privacyDocument(SITE);

function section(id: string): string {
  const found = POLICY.sections.find((candidate) => candidate.id === id);
  return found ? [...found.paragraphs, ...(found.items ?? [])].join(' ') : '';
}

/** Every source file under src, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * The privacy policy must describe the local badge accurately (Prompt 4.4).
 * Each fact here is one the code enforces; the comment names where.
 */
const text = LOCAL_BADGE_POLICY.paragraphs.join(' ');

describe('the privacy policy on the local badge', () => {
  it('shows the label exactly as the code makes it', () => {
    const example = regionLabel({ city: 'Bengaluru', country: 'IN' });
    expect(example).toBe('Bengaluru area, India');
    expect(text).toContain(`“${example}”`);
  });

  it('says it is off until turned on, per post (the toggle; the Worker needs local_badge)', () => {
    expect(text).toMatch(/off for every post until you turn it on/);
    expect(text).toMatch(/that one post only/);
  });

  it('says there is no GPS and no prompt (ESLint, tests/location.test.ts, _headers)', () => {
    expect(text).toMatch(/never use GPS/);
    expect(text).toMatch(/never asks for it/);
  });

  it('names the source: Cloudflare, from the IP address, city and country only (index.ts)', () => {
    expect(text).toMatch(/Cloudflare/);
    expect(text).toMatch(/from your IP address/);
    expect(text).toMatch(/only that city and country/);
  });

  it('says what is kept: the text alone, no IP address, no coordinates (the CHECK)', () => {
    expect(text).toMatch(/only the text of the badge/);
    expect(text).toMatch(/not your IP address, not any coordinates/);
  });

  it('says it is approximate, can be wrong, and is not offered without a city', () => {
    expect(text).toMatch(/approximate and can be wrong/);
    expect(text).toMatch(/not offered/);
  });

  it('describes the check before posting, and that it stores nothing (/api/local-badge)', () => {
    expect(text).toMatch(/stores nothing/);
    expect(text).toMatch(/worked out again when you send the post/);
  });

  it('says who sees it, and that it touches neither ranking nor moderation (pgTAP 17)', () => {
    expect(text).toMatch(/Anyone who can see the post can see its badge/);
    expect(text).toMatch(/no part in how posts are ranked/);
    expect(text).toMatch(/not sent to the services that check posts/);
    expect(text).toMatch(/deleted with the post, and when you delete your account/);
  });

  it('is part of the policy', () => {
    expect(POLICY.sections).toContain(LOCAL_BADGE_POLICY);
    expect(new Set(POLICY.sections.map((part) => part.id)).size).toBe(POLICY.sections.length);
  });
});

describe('the privacy policy on everything else (Prompt 5.2)', () => {
  it('lists every key the app keeps in browser storage, and only those', () => {
    const keys = new Set<string>();
    for (const file of sources('src')) {
      for (const match of readFileSync(file, 'utf8').matchAll(/['`](agora\.[a-z0-9.-]+)['`]/g)) {
        if (match[1]) keys.add(match[1]);
      }
    }
    const listed = DEVICE_STORAGE.map((entry) => entry.key);
    expect([...keys].sort()).toEqual([...listed].sort());
    for (const key of listed) expect(section('reading')).toContain(key);
  });

  it('names who runs it, where the data is, and the contact address', () => {
    expect(section('who')).toContain('Example Operator, based in India');
    expect(section('who')).toContain('hello@agora.example');
    expect(section('others')).toContain('the EU (Frankfurt)');
    expect(section('rights')).toContain('hello@agora.example');
  });

  it('names every outside service the app or its server sends data to', () => {
    const named = ['Supabase', 'Cloudflare', 'OpenAI', 'Google Cloud', 'Apple', 'Anthropic'];
    for (const name of [...named, 'Sentry', 'Umami']) expect(section('others')).toContain(name);
  });

  it('names whoever the CSP lets the page talk to (public/_headers)', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    const connect = /connect-src ([^;\n]*)/.exec(headers)?.[1] ?? '';
    const outside = connect.split(/\s+/).filter((source) => source !== '' && source !== "'self'");
    const services: Readonly<Record<string, string>> = {
      'supabase.co': 'Supabase',
      'sentry.io': 'Sentry',
      // A deploy without its own domain: our own API Worker, on Cloudflare.
      'workers.dev': 'Cloudflare',
    };
    expect(outside.length).toBeGreaterThan(0);
    for (const source of outside) {
      const domain = Object.keys(services).find((suffix) => source.endsWith(suffix));
      expect(domain, `${source} is in the CSP but not in the privacy policy`).toBeDefined();
      expect(section('others')).toContain(services[domain ?? ''] ?? '');
    }
  });

  it('says only a post’s text goes to moderation (moderate-post sends post.body alone)', () => {
    expect(section('moderation')).toMatch(/its text, and nothing else/);
    expect(section('moderation')).toMatch(/OpenAI/);
    expect(section('moderation')).toMatch(/Google Cloud/);
  });

  it('describes error reports as src/ui/platform/sentry.ts sends them', () => {
    const text = section('errors');
    expect(text).toMatch(/without anything after a \? or #/);
    expect(text).toMatch(/no IP address/);
    expect(text).toMatch(/no account, email address, handle or cookie/);
  });

  it('counts as src/core/analytics.ts does: six things, no identifier, no IP to Umami', () => {
    const text = section('counting');
    expect(ANALYTICS_EVENTS).toHaveLength(6);
    expect(text).toMatch(/counts six things and no more/);
    expect(text).toMatch(/Nothing identifies you/);
    expect(text).toMatch(/without your IP address/);
    expect(text).toMatch(/Global Privacy Control or Do Not Track/);
  });

  it('says deleting an account removes what the cascades remove, at once', () => {
    const text = section('keeping');
    expect(text).toMatch(/removes at once your profile, posts, votes, sides, blocks/);
    expect(text).toMatch(/Reports you made stay, with nothing linking them to you/);
    expect(text).toMatch(/removed after 7 days/);
  });
});
