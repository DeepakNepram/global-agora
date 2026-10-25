import { COMMUNITY_RULES } from '../communityRules';

import type { LegalDocument } from './types';

/**
 * The community rules page: the same rules every account agrees to (the
 * setup step shows COMMUNITY_RULES too), then how they are enforced and
 * appealed.
 */
export function rulesDocument(): LegalDocument {
  return {
    id: 'rules',
    title: 'Community rules',
    summary:
      'The rules every account agrees to before taking part in a debate, and what happens when ' +
      'a post breaks them.',
    sections: [
      {
        id: 'rules',
        title: 'The rules',
        paragraphs: [],
        items: COMMUNITY_RULES.map((rule) => `${rule.title} ${rule.detail}`),
      },
      {
        id: 'enforcement',
        title: 'How they are enforced',
        paragraphs: [
          'Every post is checked automatically before anyone else sees it, and anyone can report ' +
            'one. A post that clearly breaks the rules is removed; one that might is held back ' +
            'until a person has looked at it.',
          'A post removed for breaking the rules gives its author a strike. Three strikes suspend ' +
            'posting, voting and taking sides; reading, reporting, blocking and deleting your ' +
            'account still work.',
          'A post about harming yourself is removed without a strike, and its author is pointed ' +
            'to people who can help (https://findahelpline.com).',
        ],
      },
      {
        id: 'appeals',
        title: 'Appeals',
        paragraphs: [
          'A suspended account can appeal from its account sheet. A person reads every appeal ' +
            'and replies there.',
          'If the appeal is granted, the suspension ends and the strikes behind it stop counting; ' +
            'the posts that were removed stay removed. If it is refused, the account sheet says ' +
            'when you can appeal again.',
        ],
      },
    ],
  };
}
