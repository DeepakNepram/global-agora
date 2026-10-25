import { contactPhrase } from './site';
import type { LegalSection, LegalSite } from './types';

/**
 * The privacy policy's sections besides the local badge's (privacyPolicy.ts
 * assembles them). Each is written against the code it describes, and
 * privacyPolicy.test.ts checks the facts that can drift.
 */

/** Everything the app keeps in the browser's storage, by key: privacyPolicy.test.ts finds every key in src. */
export const DEVICE_STORAGE: readonly { readonly key: string; readonly purpose: string }[] = [
  { key: 'agora.view.v1', purpose: 'whether you chose the globe or the list, and its order' },
  { key: 'agora.follows.v1', purpose: 'the places, topics and outlets you follow' },
  { key: 'agora.saved.v1', purpose: 'the stories you saved' },
  {
    key: 'agora.onboarding.v1',
    purpose: 'whether you have seen the first-run tips, and the home city you chose there, if any',
  },
  { key: 'agora.quality-tier', purpose: 'a graphics quality you forced, a testing setting' },
  { key: 'agora.auth.v1', purpose: 'your sign-in, while you are signed in' },
  { key: 'agora.auth.v1-user', purpose: 'the signed-in account, kept with the sign-in' },
  {
    key: 'agora.auth.v1-code-verifier',
    purpose: 'a one-time value that finishes a sign-in link, deleted when it has',
  },
];

export function whoSection(site: LegalSite): LegalSection {
  const where = site.country ? `, based in ${site.country}` : '';
  // A build that does not name its operator (development) leaves the sentence out.
  const who = site.operator ? `Global Agora is run by ${site.operator}${where}. ` : '';
  return {
    id: 'who',
    title: 'Who we are',
    paragraphs: [
      `${who}This policy says what the app collects, why, who else handles it, and how long it ` +
        `is kept. For anything in it, ${contactPhrase(site)}.`,
    ],
  };
}

export const READING_SECTION: LegalSection = {
  id: 'reading',
  title: 'Reading the news',
  paragraphs: [
    'You can read without an account. Like every website, our server receives your IP address ' +
      'and the name of your browser with each request; it uses them only to answer, and does ' +
      'not record them.',
    'The app keeps a few things in your browser’s storage so that it remembers your choices. ' +
      'They stay on your device, unless you sign in: then your follows and saved stories are ' +
      'copied to your account.',
  ],
  items: DEVICE_STORAGE.map(({ key, purpose }) => `${key}: ${purpose}.`),
};

export const ACCOUNT_SECTION: LegalSection = {
  id: 'account',
  title: 'Your account',
  paragraphs: [
    'An account needs an email address, or a Google or Apple account that gives us one. With ' +
      'it we keep your handle, your answer that you are 17 or older, when you agreed to the ' +
      'community rules, and when the account was made. Your handle is public; your email ' +
      'address never is.',
    'If you sign in with Google or Apple, Supabase, which runs our sign-in, also records the ' +
      'name and picture they send. Global Agora never shows or uses them.',
    'Sign-in links and codes are emailed to you through our email provider. They are the only ' +
      'emails the app sends.',
  ],
};

export const TAKING_PART_SECTION: LegalSection = {
  id: 'taking-part',
  title: 'Taking part',
  paragraphs: [
    'When you take part in a debate we keep your posts (their text, kind and any link you add), ' +
      'the side you take, your votes, the posts you report and the accounts you block. Your ' +
      'posts show your handle and your side to anyone who opens the debate; your votes are ' +
      'counted in what others see, but not shown as yours.',
    'Following and saving with an account keeps those lists with the account, so they are on ' +
      'every device you sign in on.',
  ],
};

export const MODERATION_SECTION: LegalSection = {
  id: 'moderation',
  title: 'How posts are checked',
  paragraphs: [
    'Before anyone else sees a post, its text, and nothing else (not your handle, not your ' +
      'account, not its local badge), is sent to two services that check it against the ' +
      'community rules: OpenAI’s moderation service and Google Cloud’s Natural Language text ' +
      'moderation. We keep the scores they return with the post.',
    'People who moderate Global Agora can read posts, reports and an account’s strikes. A post ' +
      'removed for breaking the rules gives its author a strike, recorded with the account.',
    'When a moderator asks for a draft question for a new debate, the story’s headline, snippet ' +
      'and the outlets’ headlines are sent to Anthropic’s Claude. Nothing about any reader is in ' +
      'it.',
  ],
};

export const ERRORS_SECTION: LegalSection = {
  id: 'errors',
  title: 'Error reports',
  paragraphs: [
    'When the app hits an error, it sends a report to Sentry so that we can fix it: what went ' +
      'wrong and where in the code, your browser and operating system, the page’s address ' +
      'without anything after a ? or #, and the app’s last steps, such as which of our ' +
      'addresses it called.',
    'A report carries no IP address (Sentry is told not to record one), no account, email ' +
      'address, handle or cookie, and no post text. Sentry deletes reports after its retention ' +
      'period.',
  ],
};

export function othersSection(site: LegalSite): LegalSection {
  const region = site.dataRegion ? ` Its database is in ${site.dataRegion}.` : '';
  return {
    id: 'others',
    title: 'Who else handles data',
    paragraphs: ['Each of these does only the job named here:'],
    items: [
      `Supabase: our database and sign-in.${region}`,
      'Cloudflare: serves the app and our server, and estimates the city of a connection for ' +
        'the local badge.',
      'OpenAI and Google Cloud: check posts’ text against the rules.',
      'Google and Apple: sign you in, if you choose them.',
      'Anthropic: drafts debate questions from stories, for moderators.',
      'Sentry: receives error reports.',
      'Our email provider: sends sign-in links and codes.',
    ],
  };
}

export const KEEPING_SECTION: LegalSection = {
  id: 'keeping',
  title: 'How long it is kept',
  paragraphs: [
    'Your account, and everything in it, lasts until you delete it. Deleting it (account sheet, ' +
      'then Delete account) removes at once your profile, posts, votes, sides, blocks, ' +
      'notifications, follows and saved stories. Reports you made stay, with nothing linking ' +
      'them to you, so that moderation can finish. Copies in our providers’ backups go in their ' +
      'normal course.',
    'A sign-up that was never finished is removed after 7 days.',
  ],
};

export function rightsSection(site: LegalSite): LegalSection {
  return {
    id: 'rights',
    title: 'Your choices',
    paragraphs: [
      'You can delete your account in the app at any time. For a copy of your data, or to ' +
        `correct it, ${contactPhrase(site)}; we answer within 30 days. Depending on where you ` +
        'live, you may also complain to your data protection authority.',
      'Global Agora is for people 17 and older. An account made by someone younger is deleted.',
      'If this policy changes in a way that matters, the app tells you. The date at the top ' +
        'says when it last changed.',
    ],
  };
}
