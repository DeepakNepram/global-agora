import type { LegalDocument, LegalSite } from './types';

/** The contact route (Prompt 5.2): one real inbox, the build's VITE_CONTACT_EMAIL. */
export function contactDocument(site: LegalSite): LegalDocument {
  const where = site.contactEmail
    ? `Write to ${site.contactEmail}. A person reads every message.`
    : 'This build has no contact address set (VITE_CONTACT_EMAIL).';
  return {
    id: 'contact',
    title: 'Contact',
    summary: where,
    sections: [
      {
        id: 'what',
        title: 'What to write about',
        paragraphs: ['Anything at all, and in particular:'],
        items: [
          'Something broken: what you did, what you saw, and which browser and device you used.',
          'A post that breaks the rules: use Report on the post itself when you can, which ' +
            'reaches the moderators faster.',
          'A wrong place on the map: use the story’s own wrong-location report.',
          'Your data: a copy of it, or a correction. Deleting your account is in the account ' +
            'sheet and takes effect at once.',
          'A suspension: appeal from the account sheet, where the answer will appear.',
        ],
      },
    ],
  };
}
