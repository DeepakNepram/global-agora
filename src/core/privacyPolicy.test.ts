import { describe, expect, it } from 'vitest';

import { regionLabel } from './localBadge';
import { LOCAL_BADGE_POLICY, PRIVACY_POLICY } from './privacyPolicy';

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
    expect(PRIVACY_POLICY).toContain(LOCAL_BADGE_POLICY);
    expect(new Set(PRIVACY_POLICY.map((section) => section.id)).size).toBe(PRIVACY_POLICY.length);
  });
});
