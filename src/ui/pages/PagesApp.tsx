import { useEffect, type JSX } from 'react';

import { LEGAL_PAGES, legalPage, legalPageAt } from '@/core/legal/site';
import type { LegalSite } from '@/core/legal/types';

import LegalBody from './LegalBody';

const LINK =
  'rounded-full px-3 py-1.5 text-sm text-ink hover:bg-white/10 aria-[current=page]:bg-ink aria-[current=page]:text-void focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const HOME =
  'text-accent underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/**
 * The documents as pages of their own (Prompt 5.2): /about, /rules,
 * /privacy, /terms and /contact, for sharing, printing and reading without
 * the globe; and "Page not found" for any other path. Loaded instead of the
 * app, like /admin, so they never wait for WebGL.
 */
export function PagesApp({
  path,
  site,
}: {
  readonly path: string;
  readonly site: LegalSite;
}): JSX.Element {
  const id = legalPageAt(path);
  const title = id ? legalPage(id).title : 'Page not found';

  useEffect(() => {
    document.title = `${title} · Global Agora`;
    // The text arrives after the browser looked for #section: look again.
    if (window.location.hash) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
    }
  }, [title]);

  return (
    <div className="min-h-full bg-void text-ink">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-void"
      >
        Skip to the content
      </a>
      <header className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-6 py-5">
        <a href="/" className="text-lg font-semibold tracking-tight text-ink hover:text-accent">
          Global Agora
        </a>
        <nav aria-label="Documents">
          <ul className="flex flex-wrap gap-1">
            {LEGAL_PAGES.map((page) => (
              <li key={page.id}>
                <a
                  href={page.path}
                  className={LINK}
                  aria-current={page.id === id ? 'page' : undefined}
                >
                  {page.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto flex max-w-3xl flex-col gap-4 px-6 pb-16 pt-4 outline-none"
      >
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {id ? (
          <LegalBody id={id} site={site} level={2} />
        ) : (
          <p className="text-sm">
            There is nothing at this address.{' '}
            <a href="/" className={HOME}>
              Back to the news
            </a>
          </p>
        )}
      </main>
      <footer className="mx-auto max-w-3xl px-6 pb-8 text-sm">
        <a href="/" className={HOME}>
          Back to the news
        </a>
      </footer>
    </div>
  );
}
