import type { JSX, MouseEvent, ReactNode } from 'react';

import { legalPage } from '@/core/legal/site';
import type { LegalDocId } from '@/core/legal/types';
import { documentStore } from '@/state';

export const DOC_LINK =
  'text-accent underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

export interface DocLinkProps {
  readonly doc: LegalDocId;
  /** A section of it to open at. */
  readonly section?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * A link to one of the app's documents (Prompt 5.2). A plain click opens it
 * in the sheet over the app, so reading the rules never loses a debate; it
 * is a real link to the page, so a new tab, a copied address or a click with
 * a modifier key gets the page itself.
 */
export function DocLink({ doc, section, className, children }: DocLinkProps): JSX.Element {
  const page = legalPage(doc);
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    documentStore.getState().openDocument(doc, section);
  };
  return (
    <a
      href={section ? `${page.path}#${section}` : page.path}
      className={className ?? DOC_LINK}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
