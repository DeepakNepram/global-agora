import { expect, test } from './fixtures/app';

/**
 * Prompt 5.2: the documents, as pages and in the sheet over the app, linked
 * from inside it; and "Page not found" for any other path.
 */

test.describe('the documents as pages', () => {
  test('the privacy policy, opened at the local badge', async ({ app }) => {
    await app.open({ path: '/privacy#local-badge' });
    await expect(app.page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      app.page.getByRole('heading', { level: 2, name: 'The local badge on posts' }),
    ).toBeInViewport();
    await expect(app.page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await app.expectAccessible('privacy page');
  });

  test('every other document has its page', async ({ app }) => {
    for (const [path, title] of [
      ['/about', 'About Global Agora'],
      ['/rules', 'Community rules'],
      ['/terms', 'Terms of use'],
      ['/contact', 'Contact'],
    ] as const) {
      await app.page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(app.page.getByRole('heading', { level: 1, name: title })).toBeVisible({
        timeout: 20_000,
      });
    }
    await app.expectAccessible('contact page');
  });

  test('a path that is nothing says so, and leads back', async ({ app }) => {
    await app.open({ path: '/no-such-page' });
    await expect(app.page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(app.page).toHaveTitle('Page not found · Global Agora');
    await app.expectAccessible('page not found');
    await app.page.getByRole('link', { name: 'Back to the news' }).first().click();
    await expect(app.page.getByText(/120 stories/).first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('the documents inside the app', () => {
  test('from the footer: the sheet takes focus, switches, and gives focus back', async ({
    app,
  }) => {
    await app.open();
    const link = app.page.getByRole('link', { name: 'Community rules' });
    await link.click();
    const sheet = app.page.getByRole('dialog', { name: 'Community rules' });
    await expect(sheet.getByRole('heading', { name: 'Community rules' })).toBeFocused();
    await app.expectAccessible('rules sheet');

    await sheet.getByRole('button', { name: 'Privacy' }).click();
    const privacy = app.page.getByRole('dialog', { name: 'Privacy policy' });
    await expect(privacy.getByRole('heading', { name: 'Privacy policy', level: 2 })).toBeFocused();

    await app.page.keyboard.press('Escape');
    await expect(link).toBeFocused();
  });

  test('over the sign-in sheet, and back to it', async ({ app }) => {
    await app.open();
    await app.page.getByRole('button', { name: 'Sign in' }).click();
    const signIn = app.page.getByRole('dialog', { name: /Sign in/ });
    const terms = signIn.getByRole('link', { name: 'terms of use' });
    await terms.click();

    const sheet = app.page.getByRole('dialog', { name: 'Terms of use' });
    await expect(sheet.getByRole('heading', { name: 'Terms of use', level: 2 })).toBeFocused();
    // Modal over the modal: Tab stays in the document.
    for (let i = 0; i < 8; i++) {
      await app.page.keyboard.press('Tab');
      expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
    await app.page.keyboard.press('Escape');
    await expect(terms).toBeFocused();
    await expect(signIn.getByRole('heading', { name: /Sign in/ })).toBeVisible();
  });
});
