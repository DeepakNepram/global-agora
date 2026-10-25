import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/app';

/**
 * Prompt 5.2: the app when the platform lets it down. Offline (the service
 * worker), a lost WebGL context, a crash; and the content security policy
 * holding throughout. No WebGL at all is no-webgl.spec.ts (its own browser).
 */

/** Only once three.js has made its context (it marks the canvas): asking earlier would make one. */
const GLOBE_CANVAS = '[aria-roledescription="globe"] canvas[data-engine]';

function loseContext(page: Page): Promise<void> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector<HTMLCanvasElement>(selector);
    canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  }, GLOBE_CANVAS);
}

function contextLost(page: Page): Promise<boolean | null> {
  return page.evaluate((selector) => {
    const gl = document.querySelector<HTMLCanvasElement>(selector)?.getContext('webgl2');
    return gl ? gl.isContextLost() : null;
  }, GLOBE_CANVAS);
}

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('the saved news opens offline, saying how old it is', async ({ app, context }) => {
    await app.open({ layout: 'list' });
    // Installed and in control; the next load goes through it and saves the news.
    await app.page.evaluate(() =>
      navigator.serviceWorker.ready.then(
        () =>
          new Promise<void>((done) => {
            if (navigator.serviceWorker.controller) done();
            else navigator.serviceWorker.addEventListener('controllerchange', () => done());
          }),
      ),
    );
    await app.page.reload({ waitUntil: 'domcontentloaded' });
    await expect(app.page.getByText(/120 stories/).first()).toBeVisible({ timeout: 30_000 });

    await context.setOffline(true);
    await app.page.reload({ waitUntil: 'domcontentloaded' });
    const banner = app.page.getByTestId('offline-banner');
    await expect(banner).toContainText(/You’re offline\. Showing news from/, { timeout: 30_000 });
    await expect(app.page.getByText(/120 stories/).first()).toBeVisible();
    await app.expectAccessible('offline, saved news');

    await context.setOffline(false);
    await expect(banner).toHaveText('', { timeout: 20_000 });
  });
});

test.describe('the globe’s graphics', () => {
  test('a lost context is restored, and the third in a row brings the flat map', async ({
    app,
  }) => {
    await app.open();
    await expect(app.page.locator(GLOBE_CANVAS)).toBeVisible();
    for (let loss = 1; loss <= 2; loss++) {
      await expect(app.page.locator(GLOBE_CANVAS)).toBeVisible({ timeout: 15_000 });
      await loseContext(app.page);
      await expect(app.page.getByText('Restoring the globe…')).toBeVisible();
      await expect(app.page.getByText('Restoring the globe…')).toBeHidden({ timeout: 15_000 });
      await expect.poll(() => contextLost(app.page), { timeout: 15_000 }).toBe(false);
    }
    await expect(app.page.locator(GLOBE_CANVAS)).toBeVisible({ timeout: 15_000 });
    await loseContext(app.page);
    await expect(app.page.getByTestId('globe-notice')).toContainText(
      'kept losing its graphics, so this is the flat map',
      { timeout: 15_000 },
    );
    await expect(app.page.locator('[aria-roledescription="map"]')).toBeVisible();
    await app.expectAccessible('globe lost, flat map');
  });
});

test('a crash shows a way back, not a white page', async ({ app }) => {
  // Every date format throws: the first render that shows a time fails.
  await app.page.addInitScript(() => {
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', {
      configurable: true,
      get() {
        throw new Error('e2e: a render that fails');
      },
    });
  });
  await app.open({ news: 'failing' });
  const heading = app.page.getByRole('heading', { name: 'Something went wrong' });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  await expect(heading).toBeFocused();
  await expect(app.page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(app.page.getByRole('button', { name: 'Open the list view' })).toBeVisible();
  await app.expectAccessible('crash screen');
});

test('the content security policy is served, and nothing breaks it', async ({ app }) => {
  await app.page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await app.open();
  await app.page
    .locator('[data-story-id]')
    .first()
    .click({ timeout: 1000 })
    .catch(() => undefined);
  await app.page.getByRole('link', { name: 'Privacy policy' }).click();
  await expect(app.page.getByRole('dialog', { name: 'Privacy policy' })).toBeVisible();
  await app.page.keyboard.press('Escape');
  // The radio is visually hidden; its label is what a hand presses.
  await app.page.getByRole('radio', { name: 'List' }).check({ force: true });
  await app.page.locator('[data-story-id]').first().click();
  await expect(app.page.locator('[data-story-sheet]')).not.toHaveAttribute('inert', '');

  const served = await app.page.request.get('/');
  expect(served.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(served.headers()['x-robots-tag']).toBe('noindex');
  expect(await app.page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual(
    [],
  );
});
