import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

import { AUTH_STORAGE_KEY } from '@/core/auth';

import { GUEST, routeBackend, storedSession, type Persona } from './backend';
import { nodesPayload, outletsIndex, storyDetail, tinyTexture } from './news';

/** Where the e2e build looks for Supabase (scripts/e2e/build.ts); only the stand-in answers. */
export const SUPABASE_ORIGIN = 'http://supabase.e2e.test';

export interface OpenOptions {
  readonly persona?: Persona;
  /** Emulates prefers-reduced-motion: the flat map instead of the globe. */
  readonly reducedMotion?: boolean;
  readonly layout?: 'visual' | 'list';
  /** A path and query to open, e.g. "/?story=12" or "/admin". */
  readonly path?: string;
  /** Leave the first-run onboarding to show itself (by default it is marked done). */
  readonly onboarding?: boolean;
}

export interface App {
  readonly page: Page;
  /** Opens the app as `options` say, once its stories are in. */
  open(options?: OpenOptions): Promise<void>;
  /** Fails with every axe violation (WCAG 2.2 A and AA, and best practice), named for `state`. */
  expectAccessible(state: string): Promise<void>;
}

/** WCAG 2.0 to 2.2, A and AA, and axe's best practices. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function routeNews(page: Page): Promise<void> {
  const texture = await tinyTexture();
  await page.route('**/api/nodes?*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(nodesPayload()) }),
  );
  await page.route('**/api/story/*', async (route) => {
    const seq = Number(new URL(route.request().url()).pathname.split('/').pop());
    const detail = storyDetail(seq);
    await route.fulfill(
      detail
        ? { contentType: 'application/json', body: JSON.stringify(detail) }
        : { status: 404, body: '' },
    );
  });
  await page.route('**/api/outlets?*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(outletsIndex()) }),
  );
  await page.route('**/api/outlets/*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ outlet: 'harbour-gazette.example', ids: [3, 2, 1] }),
    }),
  );
  await page.route('**/textures/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: texture }),
  );
}

function createApp(page: Page): App {
  return {
    page,
    async open(options = {}) {
      const persona = options.persona ?? GUEST;
      await routeNews(page);
      await routeBackend(page, SUPABASE_ORIGIN, persona);
      await page.emulateMedia({
        reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference',
      });
      const storage: Record<string, string> = {
        'agora.view.v1': JSON.stringify({ layout: options.layout ?? 'visual', sort: 'newest' }),
        // The checks are about the page, not the picture: LOW keeps software GL (CI) quick.
        'agora.quality-tier': 'low',
      };
      if (!options.onboarding) {
        storage['agora.onboarding.v1'] = JSON.stringify({
          status: 'skipped',
          usedSeconds: 999,
          homeCity: null,
          alerts: false,
        });
      }
      if (persona.signedIn) storage[AUTH_STORAGE_KEY] = storedSession();
      await page.addInitScript((entries: Record<string, string>) => {
        for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
      }, storage);
      // The DOM is enough: what each check needs, it waits for itself.
      await page.goto(options.path ?? '/', { waitUntil: 'domcontentloaded' });
      if (!(options.path ?? '/').startsWith('/admin')) {
        await expect(page.getByText(/120 stories/).first()).toBeVisible({ timeout: 30_000 });
      }
    },
    async expectAccessible(state) {
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      const found = results.violations.map((violation) => ({
        rule: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map(
          (node) => `${node.target.join(' ')}: ${node.failureSummary ?? ''}`,
        ),
      }));
      expect(found, `axe violations: ${state}`).toEqual([]);
    },
  };
}

export const test = base.extend<{ app: App }>({
  // Playwright's fixture callback, named so the React hooks lint does not take it for use().
  app: async ({ page }, provide) => {
    await provide(createApp(page));
  },
});

export { expect };
