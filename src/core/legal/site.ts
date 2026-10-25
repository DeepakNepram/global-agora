import type { LegalDocId, LegalSite } from './types';

type EnvBag = Readonly<Record<string, string | undefined>>;

/** When the documents last changed in substance (shown on each). */
export const LEGAL_UPDATED_AT = '25 October 2026';

/** The documents, in the order every menu lists them, with their page paths. */
export const LEGAL_PAGES: readonly {
  readonly id: LegalDocId;
  readonly title: string;
  readonly path: string;
}[] = [
  { id: 'about', title: 'About Global Agora', path: '/about' },
  { id: 'rules', title: 'Community rules', path: '/rules' },
  { id: 'privacy', title: 'Privacy policy', path: '/privacy' },
  { id: 'terms', title: 'Terms of use', path: '/terms' },
  { id: 'contact', title: 'Contact', path: '/contact' },
];

export function legalPage(id: LegalDocId): (typeof LEGAL_PAGES)[number] {
  const page = LEGAL_PAGES.find((candidate) => candidate.id === id);
  if (!page) throw new Error(`no document ${id}`);
  return page;
}

/** The document at a path ("/privacy", "/privacy/"), or null. */
export function legalPageAt(path: string): LegalDocId | null {
  const normal = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return LEGAL_PAGES.find((page) => page.path === normal)?.id ?? null;
}

function value(env: EnvBag, key: string): string | null {
  const raw = env[key]?.trim();
  return raw ? raw : null;
}

/** The build's VITE_OPERATOR_NAME, VITE_OPERATOR_COUNTRY, VITE_CONTACT_EMAIL and VITE_DATA_REGION. */
export function legalSiteFromEnv(env: EnvBag): LegalSite {
  return {
    operator: value(env, 'VITE_OPERATOR_NAME'),
    country: value(env, 'VITE_OPERATOR_COUNTRY'),
    contactEmail: value(env, 'VITE_CONTACT_EMAIL'),
    dataRegion: value(env, 'VITE_DATA_REGION'),
  };
}

/** How the documents name the operator before the build says who it is. */
export function operatorName(site: LegalSite): string {
  return site.operator ?? 'the people who run Global Agora';
}

/** "write to hello@example.org", or a plain fallback in a build without an address. */
export function contactPhrase(site: LegalSite): string {
  return site.contactEmail
    ? `write to ${site.contactEmail}`
    : 'use the address on the Contact page';
}
