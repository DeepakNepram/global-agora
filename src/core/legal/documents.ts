import { privacyDocument } from '../privacyPolicy';

import { aboutDocument } from './about';
import { contactDocument } from './contact';
import { rulesDocument } from './rules';
import { termsDocument } from './terms';
import type { LegalDocId, LegalDocument, LegalSite } from './types';

/** A document, with the operator's details filled in. */
export function legalDocument(id: LegalDocId, site: LegalSite): LegalDocument {
  switch (id) {
    case 'about':
      return aboutDocument(site);
    case 'rules':
      return rulesDocument();
    case 'privacy':
      return privacyDocument(site);
    case 'terms':
      return termsDocument(site);
    case 'contact':
      return contactDocument(site);
  }
}
