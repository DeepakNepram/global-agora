import { contactPhrase, operatorName } from './site';
import type { LegalDocument, LegalSite } from './types';

/** The terms of use: a DRAFT for the owner to edit and have reviewed (types.ts). */
export function termsDocument(site: LegalSite): LegalDocument {
  const operator = operatorName(site);
  const law = site.country
    ? `the laws of ${site.country}`
    : 'the laws of the country where Global Agora’s operator is based';
  return {
    id: 'terms',
    title: 'Terms of use',
    summary: `An agreement between you and ${operator}. Using Global Agora means you accept it.`,
    sections: [
      {
        id: 'alpha',
        title: 'An alpha',
        paragraphs: [
          'Global Agora is an invite-only alpha: a test of an unfinished service. It may change, ' +
            'break, lose data or stop, at any time and without notice, and it is provided as it ' +
            'is.',
        ],
      },
      {
        id: 'accounts',
        title: 'Accounts',
        paragraphs: [
          'Anyone may read the news. An account is by invitation, for people 17 or older, one ' +
            'per person. Making one means agreeing to the community rules as well as these ' +
            'terms. Keep the email address you sign in with secure: whoever can read it can sign ' +
            'in as you.',
        ],
      },
      {
        id: 'news',
        title: 'The news',
        paragraphs: [
          'The stories come from the GDELT Project and the outlets it monitors. Global Agora shows ' +
            'headlines, short snippets and links; the articles belong to their publishers. We do ' +
            'not check stories for accuracy, and their places and categories are worked out ' +
            'automatically and can be wrong.',
        ],
      },
      {
        id: 'posts',
        title: 'Your posts',
        paragraphs: [
          `What you post stays yours. You give ${operator} a worldwide, free licence to store, ` +
            'copy and show it, so that Global Agora can work, for as long as it is on Global ' +
            'Agora. Do not post what you have no right to post.',
          'Posts are public: anyone who opens the debate can read them, with your handle.',
        ],
      },
      {
        id: 'rules',
        title: 'The rules',
        paragraphs: [
          'Follow the community rules. Posts that break them may be removed or held back for ' +
            'review, and their authors given strikes; three strikes suspend posting, voting and ' +
            'taking sides. A suspended account can appeal. We may close an account that breaks ' +
            'the rules or these terms seriously or repeatedly.',
        ],
      },
      {
        id: 'ending',
        title: 'Ending',
        paragraphs: [
          'You can delete your account at any time, from the account sheet. We may end the alpha, ' +
            'or your access to it.',
        ],
      },
      {
        id: 'liability',
        title: 'Liability',
        paragraphs: [
          `As far as the law allows, Global Agora comes without warranties, and ${operator} is ` +
            'not liable for indirect or consequential loss, or for what other people post or ' +
            'what news outlets publish. Nothing here takes away rights that the law says cannot ' +
            'be taken away.',
        ],
      },
      {
        id: 'changes',
        title: 'Changes and law',
        paragraphs: [
          'We may change these terms. The date at the top says when they last changed, and the ' +
            'app tells you about any change that matters.',
          `These terms are governed by ${law}.`,
          `Questions about them: ${contactPhrase(site)}.`,
        ],
      },
    ],
  };
}
