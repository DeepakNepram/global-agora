import { describe, expect, it } from 'vitest';

import { COMMUNITY_RULES } from '../communityRules';

import { legalDocument } from './documents';
import { LEGAL_PAGES, legalPageAt, legalSiteFromEnv } from './site';
import type { LegalDocId, LegalSite } from './types';

const SITE: LegalSite = {
  operator: 'Example Operator',
  country: 'India',
  contactEmail: 'hello@agora.example',
  dataRegion: 'the EU (Frankfurt)',
};
const UNSET: LegalSite = { operator: null, country: null, contactEmail: null, dataRegion: null };

function text(id: LegalDocId, site: LegalSite = SITE): string {
  const doc = legalDocument(id, site);
  return [
    doc.summary,
    ...doc.sections.flatMap((part) => [part.title, ...part.paragraphs, ...(part.items ?? [])]),
  ].join(' ');
}

describe('the legal documents', () => {
  it('each has a page, a title and sections with unique ids', () => {
    expect(new Set(LEGAL_PAGES.map((page) => page.path)).size).toBe(LEGAL_PAGES.length);
    for (const page of LEGAL_PAGES) {
      const doc = legalDocument(page.id, SITE);
      expect(doc.id).toBe(page.id);
      expect(doc.title).toBe(page.title);
      expect(doc.sections.length).toBeGreaterThan(0);
      expect(new Set(doc.sections.map((part) => part.id)).size).toBe(doc.sections.length);
    }
  });

  it('finds a document by its path', () => {
    expect(legalPageAt('/privacy')).toBe('privacy');
    expect(legalPageAt('/terms/')).toBe('terms');
    expect(legalPageAt('/')).toBeNull();
    expect(legalPageAt('/nowhere')).toBeNull();
  });

  it('reads who runs it from the build, blank values as unset', () => {
    const site = legalSiteFromEnv({
      VITE_OPERATOR_NAME: ' Example Operator ',
      VITE_OPERATOR_COUNTRY: '',
      VITE_CONTACT_EMAIL: 'hello@agora.example',
    });
    expect(site).toEqual({
      operator: 'Example Operator',
      country: null,
      contactEmail: 'hello@agora.example',
      dataRegion: null,
    });
  });

  it('the rules page carries every rule the setup step asks people to agree to', () => {
    for (const rule of COMMUNITY_RULES) expect(text('rules')).toContain(rule.title);
    expect(text('rules')).toMatch(/Three strikes suspend/);
    expect(text('rules')).toMatch(/appeal from its account sheet/);
  });

  it('the terms name the operator, the age line and the governing law', () => {
    const terms = text('terms');
    expect(terms).toContain('Example Operator');
    expect(terms).toMatch(/17 or older/);
    expect(terms).toContain('the laws of India');
  });

  it('the contact page gives the real inbox', () => {
    expect(text('contact')).toContain('hello@agora.example');
  });

  it('still reads, without placeholders, before the build names an operator', () => {
    for (const page of LEGAL_PAGES) expect(text(page.id, UNSET)).not.toMatch(/null|undefined/);
  });
});
