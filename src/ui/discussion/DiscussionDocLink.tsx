import type { JSX, MouseEvent, ReactNode } from 'react';

import { legalPage, type LegalDocId } from '@/core';
import { documentStore } from '@/state';

/**
 * ../legal/DocLink for the discussion panel's chunk: the same link, through
 * the barrels the chunk already shares with the start. Importing DocLink's
 * module here made rolldown split the start into five files
 * (docs/DECISIONS.md, Prompt 5.2).
 */
export function DiscussionDocLink(props: {
  readonly doc: LegalDocId;
  readonly section?: string;
  readonly className: string;
  readonly children: ReactNode;
}): JSX.Element {
  const { doc, section, className, children } = props;
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
      className={className}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
