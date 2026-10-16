/**
 * The privacy policy's text, as Prompt 5.2's privacy page will show it.
 *
 * A DRAFT, like communityRules.ts: the owner edits the wording, and 5.2 adds
 * the other sections (accounts, the services that check posts, analytics,
 * contact). Each section is written against the code it describes, and
 * privacyPolicy.test.ts checks its facts, so a change to what the app
 * collects fails a test until the policy says so too.
 */

// Explicit .ts: scripts/db/smoke.ts loads core modules under plain Node.
import { regionLabel } from './localBadge.ts';

export interface PolicySection {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
}

/** The real format, from the code that makes it, never a hand-typed copy. */
const EXAMPLE = regionLabel({ city: 'Bengaluru', country: 'IN' }) ?? '';

/** Prompt 4.4: the local badge, from Cloudflare's IP-derived city and country. */
export const LOCAL_BADGE_POLICY: PolicySection = {
  id: 'local-badge',
  title: 'The local badge on posts',
  paragraphs: [
    `When you write a post, you can choose to show a local badge on it, such as “${EXAMPLE}”. ` +
      'It is off for every post until you turn it on, and it applies to that one post only.',
    "We never use GPS or your device's location, and the app never asks for it. The badge " +
      'comes from your internet connection instead: Cloudflare, which serves the app, estimates ' +
      'from your IP address which city and country your connection is in. We read only that ' +
      'city and country, and only when you send a post with the badge turned on.',
    'The post keeps only the text of the badge. Nothing else about your connection is stored ' +
      'with it: not your IP address, not any coordinates. A post without the badge stores no ' +
      'place at all.',
    'Because it comes from your connection, the badge is approximate and can be wrong. A VPN, ' +
      'a mobile network or a work network can place you in another city. If the city of your ' +
      'connection is unknown, the badge is not offered.',
    'When you start a post, the app asks our server what the badge would say, so you can see it ' +
      'before you choose. That check uses the same estimate and stores nothing. The badge is ' +
      'worked out again when you send the post, so if your connection changed in between, it ' +
      'may read differently, or be left off.',
    'Anyone who can see the post can see its badge. The badge plays no part in how posts are ' +
      'ranked, and it is not sent to the services that check posts against the community ' +
      'rules. It is deleted with the post, and when you delete your account.',
  ],
};

/** The sections written so far, in page order. */
export const PRIVACY_POLICY: readonly PolicySection[] = [LOCAL_BADGE_POLICY];
