import { Fragment, useEffect, useId, type JSX, type ReactNode } from 'react';

import { legalDocument } from '@/core/legal/documents';
import { LEGAL_UPDATED_AT } from '@/core/legal/site';
import type { LegalDocId, LegalSite } from '@/core/legal/types';
import { useAnalyticsConsent } from '@/state';

const LINK =
  'text-accent underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/** Web addresses and email addresses in the text, as links. */
const LINKABLE = /(https:\/\/[^\s)]+[^\s).,;:]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

function linkify(text: string): ReactNode {
  const parts = text.split(LINKABLE);
  return parts.map((part, index) => {
    if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>;
    const href = part.startsWith('https://') ? part : `mailto:${part}`;
    const external = href.startsWith('https://');
    return (
      <a
        key={index}
        href={href}
        className={LINK}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {part}
      </a>
    );
  });
}

/**
 * The privacy policy's "Count my visits" (Prompt 5.2), under the section that
 * explains it. The browser's own Global Privacy Control or Do Not Track wins.
 */
function CountingSwitch(): JSX.Element {
  const counting = useAnalyticsConsent((state) => state.counting);
  const setCounting = useAnalyticsConsent((state) => state.setCounting);
  const id = useId();
  const nav = navigator as Navigator & { readonly globalPrivacyControl?: boolean };
  const blocked = nav.globalPrivacyControl === true || nav.doNotTrack === '1';
  return (
    <div className="flex items-start gap-3 rounded-xl border border-edge p-3">
      <input
        id={id}
        type="checkbox"
        checked={counting && !blocked}
        disabled={blocked}
        onChange={(event) => setCounting(event.currentTarget.checked)}
        aria-describedby={`${id}-note`}
        className="mt-0.5 size-5 shrink-0 accent-accent disabled:opacity-50"
      />
      <div>
        <label htmlFor={id} className={blocked ? 'text-muted' : 'text-ink'}>
          Count my visits on this device
        </label>
        <p id={`${id}-note`} className="text-xs text-muted">
          {blocked
            ? 'Your browser asks sites not to track it, so nothing is counted.'
            : counting
              ? 'On: the six counts above are sent, with nothing that identifies you.'
              : 'Off: nothing is counted on this device.'}
        </p>
      </div>
    </div>
  );
}

export interface LegalBodyProps {
  readonly id: LegalDocId;
  readonly site: LegalSite;
  /** The level of each section's heading: 2 on a page (under its h1), 3 in the sheet. */
  readonly level: 2 | 3;
  /** A section to scroll to once shown. */
  readonly section?: string | null;
}

/**
 * One of the app's documents, below its title (Prompt 5.2): its summary,
 * when it last changed, and its sections. The same in the sheet inside the
 * app and on its own page; in its own chunk, so the start never carries the
 * text.
 */
export default function LegalBody({ id, site, level, section }: LegalBodyProps): JSX.Element {
  const doc = legalDocument(id, site);
  const Heading = level === 2 ? 'h2' : 'h3';

  useEffect(() => {
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' });
  }, [id, section]);

  return (
    <div className="flex flex-col gap-6 text-sm leading-relaxed text-ink">
      <div className="flex flex-col gap-1">
        <p className="text-base text-ink">{linkify(doc.summary)}</p>
        <p className="text-xs text-muted">Last updated {LEGAL_UPDATED_AT}</p>
      </div>
      {doc.sections.map((part) => (
        <section
          key={part.id}
          id={part.id}
          aria-labelledby={`${part.id}-title`}
          className="flex flex-col gap-2"
        >
          <Heading id={`${part.id}-title`} className="text-base font-semibold text-ink">
            {part.title}
          </Heading>
          {part.paragraphs.map((paragraph) => (
            <p key={paragraph}>{linkify(paragraph)}</p>
          ))}
          {part.items && (
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {part.items.map((item) => (
                <li key={item}>{linkify(item)}</li>
              ))}
            </ul>
          )}
          {doc.id === 'privacy' && part.id === 'counting' && <CountingSwitch />}
        </section>
      ))}
    </div>
  );
}
