import { lazy, Suspense, useRef, useState, type JSX } from 'react';

import { LEGAL_PAGES, legalPage } from '@/core/legal/site';
import type { LegalDocId, LegalSite } from '@/core/legal/types';
import { documentStore, useDocumentStore } from '@/state';

import { HEADING, QUIET } from '../account/accountStyles';
import { ModalSheet } from '../sheets/ModalSheet';
import { DOC_LINK } from './DocLink';

// The text in its own chunk, shared with the pages (src/ui/pages).
const LegalBody = lazy(() => import('../pages/LegalBody'));

const TAB =
  'h-8 rounded-full px-3 text-xs font-medium text-ink hover:bg-white/10 aria-[current=page]:bg-ink aria-[current=page]:text-void focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const SHORT_TITLES: Readonly<Record<LegalDocId, string>> = {
  about: 'About',
  rules: 'Rules',
  privacy: 'Privacy',
  terms: 'Terms',
  contact: 'Contact',
};

/**
 * The documents in a sheet over everything, the account sheets and a debate
 * included (Prompt 5.2): stacked, so it is modal over them, and closing it
 * gives focus back to the link that opened it. A row of buttons moves
 * between the documents; "Open as a page" gives the page itself.
 */
export function DocumentSheet({
  site,
  reducedMotion,
}: {
  readonly site: LegalSite;
  readonly reducedMotion: boolean;
}): JSX.Element {
  const open = useDocumentStore((state) => state.open);
  const section = useDocumentStore((state) => state.section);
  const heading = useRef<HTMLHeadingElement>(null);
  // Kept while the sheet slides away, so its text does not vanish first.
  const [shown, setShown] = useState<LegalDocId>('about');
  if (open !== null && open !== shown) setShown(open);
  const page = legalPage(shown);
  const close = (): void => documentStore.getState().closeDocument();

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <ModalSheet
        open={open !== null}
        stacked
        titleId="document-title"
        heading={heading}
        focusKey={shown}
        reducedMotion={reducedMotion}
        onDismiss={close}
        header={
          <>
            <nav aria-label="Documents">
              <ul className="flex flex-wrap gap-1">
                {LEGAL_PAGES.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={TAB}
                      aria-current={item.id === shown ? 'page' : undefined}
                      onClick={() => documentStore.getState().openDocument(item.id)}
                    >
                      {SHORT_TITLES[item.id]}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <button type="button" className={QUIET} onClick={close}>
              Close
            </button>
          </>
        }
      >
        <h2 id="document-title" ref={heading} tabIndex={-1} className={HEADING}>
          {page.title}
        </h2>
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
          <LegalBody id={shown} site={site} level={3} section={section} />
        </Suspense>
        <a href={page.path} target="_blank" rel="noopener" className={`${DOC_LINK} text-sm`}>
          Open as a page
        </a>
      </ModalSheet>
    </div>
  );
}
