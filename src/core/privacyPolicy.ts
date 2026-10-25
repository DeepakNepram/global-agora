/**
 * The privacy policy (Prompt 4.4's local badge section, Prompt 5.2's whole
 * page). A DRAFT, like communityRules.ts: the owner edits the wording.
 * Each section is written against the code it describes, and
 * privacyPolicy.test.ts checks its facts, so a change to what the app
 * collects fails a test until the policy says so too.
 */

import {
  ACCOUNT_SECTION,
  COUNTING_SECTION,
  ERRORS_SECTION,
  KEEPING_SECTION,
  MODERATION_SECTION,
  othersSection,
  READING_SECTION,
  rightsSection,
  TAKING_PART_SECTION,
  whoSection,
} from './legal/privacySections.ts';
import type { LegalDocument, LegalSection, LegalSite } from './legal/types.ts';
// Explicit .ts: scripts/db/smoke.ts loads core modules under plain Node.
import { regionLabel } from './localBadge.ts';

export type PolicySection = LegalSection;

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

/** The whole policy, in page order. */
export function privacyDocument(site: LegalSite): LegalDocument {
  return {
    id: 'privacy',
    title: 'Privacy policy',
    summary:
      'What Global Agora collects, why, who else handles it and for how long. In short: reading ' +
      'needs nothing from you, and an account keeps only what taking part needs.',
    sections: [
      whoSection(site),
      READING_SECTION,
      ACCOUNT_SECTION,
      TAKING_PART_SECTION,
      LOCAL_BADGE_POLICY,
      MODERATION_SECTION,
      ERRORS_SECTION,
      COUNTING_SECTION,
      othersSection(site),
      KEEPING_SECTION,
      rightsSection(site),
    ],
  };
}
