import { ADMIN, READER, SUSPENDED, type Persona } from './fixtures/backend';
import { test, expect } from './fixtures/app';
import { OPEN_DISCUSSION_SEQ } from './fixtures/news';

/**
 * axe-core on every view, sheet and panel (Prompt 5.1). Any violation of
 * WCAG 2.2 A or AA, or of axe's best practices, fails the build. Each state
 * is reached the way a reader reaches it: by clicking, typing or a link.
 */

test.describe('the views', () => {
  test('globe', async ({ app }) => {
    await app.open();
    await expect(app.page.locator('[aria-roledescription="globe"]')).toBeVisible();
    await app.expectAccessible('globe');
  });

  test('flat map, under reduced motion', async ({ app }) => {
    await app.open({ reducedMotion: true });
    await expect(app.page.locator('[aria-roledescription="map"]')).toBeVisible();
    await expect(app.page.locator('[aria-roledescription="globe"]')).toHaveCount(0);
    await app.expectAccessible('flat map');
  });

  test('list, both orders, and a second page', async ({ app }) => {
    await app.open({ layout: 'list' });
    const list = app.page.getByRole('list', { name: 'Stories' });
    await expect(list.getByRole('button')).toHaveCount(50);
    await app.expectAccessible('list, newest first');
    await app.page.getByText('Most covered').click();
    await app.page.getByRole('button', { name: /^Show \d+ more$/ }).click();
    await expect(list.getByRole('button')).toHaveCount(100);
    await app.expectAccessible('list, most covered, two pages');
  });
});

test.describe('a story', () => {
  test('peek card and full sheet', async ({ app }) => {
    await app.open({ path: '/?story=12' });
    const sheet = app.page.locator('[data-story-sheet]');
    await expect(sheet.getByRole('heading', { level: 2 })).toBeFocused();
    await app.expectAccessible('story peek card');
    await app.page.getByRole('button', { name: 'Expand story' }).click();
    await expect(sheet.getByRole('link').first()).toBeVisible();
    // Drawn up to 90 %, the sheet covers the filter row, which steps out of
    // sight and of the Tab order rather than sit half-hidden behind it.
    const filters = app.page.getByRole('group', { name: 'Show only these categories' });
    await expect(filters).toBeHidden();
    await app.expectAccessible('story full sheet');
    await app.page.getByRole('button', { name: 'Collapse story' }).click();
    await expect(filters).toBeVisible();
  });

  test('from the list', async ({ app }) => {
    await app.open({ layout: 'list' });
    await app.page.getByRole('list', { name: 'Stories' }).getByRole('button').first().click();
    await expect(app.page.locator('[aria-current="true"]')).toHaveCount(1);
    await app.expectAccessible('story over the list');
  });
});

test.describe('search, filters and the library', () => {
  test('search results', async ({ app }) => {
    await app.open();
    await app.page.getByRole('combobox', { name: /Search/ }).fill('Paris');
    await expect(app.page.getByRole('option').first()).toBeVisible();
    await app.expectAccessible('search results');
  });

  test('filters on', async ({ app }) => {
    await app.open({ layout: 'list' });
    await app.page.getByRole('button', { name: 'Conflict', exact: true }).click();
    await expect(app.page.getByText(/left out by the filters/)).toBeVisible();
    await app.expectAccessible('list with a filter');
  });

  test('library: following and saved', async ({ app }) => {
    await app.open();
    await app.page.getByRole('button', { name: 'Following' }).click();
    await expect(app.page.getByRole('tab', { name: 'Following' })).toBeFocused();
    await app.expectAccessible('library, following');
    await app.page.getByRole('tab', { name: 'Saved' }).click();
    await app.expectAccessible('library, saved');
  });

  test('onboarding, after the first save', async ({ app }) => {
    await app.open({ path: '/?story=12', onboarding: true });
    await app.page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      app.page
        .getByRole('dialog')
        .filter({ hasText: /Welcome|home/i })
        .first(),
    ).toBeVisible();
    await app.expectAccessible('onboarding');
  });
});

test.describe('accounts', () => {
  test('sign in', async ({ app }) => {
    await app.open();
    await app.page.getByRole('button', { name: 'Sign in' }).click();
    await expect(app.page.getByRole('heading', { name: /Sign in/ })).toBeFocused();
    await app.expectAccessible('sign-in sheet');
  });

  test('the account sheet', async ({ app }) => {
    await app.open({ persona: READER });
    await app.page.getByRole('button', { name: '@river_reader' }).click();
    await expect(app.page.getByRole('dialog', { name: '@river_reader' })).toBeVisible();
    await app.expectAccessible('account sheet');
  });

  test('a suspended account, and its appeal form', async ({ app }) => {
    await app.open({ persona: SUSPENDED });
    await app.page.getByRole('button', { name: '@struck_reader' }).click();
    const sheet = app.page.getByRole('dialog', { name: '@struck_reader' });
    await sheet.getByRole('button', { name: 'Appeal this suspension' }).click();
    const field = sheet.getByLabel('Why should the suspension end?');
    await expect(field).toBeFocused();
    await app.expectAccessible('appeal form');
    await field.fill('The second post quoted the article.');
    await sheet.getByRole('button', { name: 'Send appeal' }).click();
    // The fixture's profile has no appeal, so the form stays: what matters is the call went.
  });

  test('setup, before a handle is chosen', async ({ app }) => {
    const newcomer: Persona = { signedIn: true, handle: null };
    await app.open({ persona: newcomer });
    // The open sheet: a closed one is inert (the documents' sheet is always there).
    await expect(app.page.locator('[role="dialog"]:not([inert])')).toBeVisible();
    await app.expectAccessible('setup sheet');
  });
});

test.describe('a discussion', () => {
  for (const [who, persona] of [
    ['a guest', undefined],
    ['a participant', READER],
  ] as const) {
    test(`as ${who}`, async ({ app }) => {
      await app.open({ path: `/?story=${OPEN_DISCUSSION_SEQ}`, ...(persona ? { persona } : {}) });
      await app.page.getByRole('button', { name: /Discuss|Join/ }).click();
      const panel = app.page.getByRole('dialog', { name: /ferry/ });
      // Its chunk and the SDK load first; software GL in CI makes that slow.
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel.getByRole('article').first()).toBeVisible();
      await app.expectAccessible(`discussion as ${who}`);
      if (persona) {
        await panel.getByRole('button', { name: /More for @voice_1/ }).click();
        await app.expectAccessible('post menu');
      }
    });
  }
});

test.describe('the admin console', () => {
  for (const [tab, path] of [
    ['hot stories', '/admin'],
    ['moderation', '/admin/moderation'],
    ['appeals', '/admin/appeals'],
    ['locations', '/admin/locations'],
  ] as const) {
    test(tab, async ({ app }) => {
      await app.open({ persona: ADMIN, path });
      // The SDK's chunk and the role check come first.
      await expect(app.page.getByRole('tab', { selected: true })).toBeVisible({ timeout: 30_000 });
      await app.expectAccessible(`admin, ${tab}`);
    });
  }
});

test('the admin console: deciding an appeal', async ({ app }) => {
  await app.open({ persona: ADMIN, path: '/admin/appeals' });
  const card = app.page.getByRole('article', { name: /@struck_reader/ });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByLabel(/Reply to @struck_reader/).fill('Granted: it was a quotation.');
  await card.getByRole('button', { name: 'Grant…' }).click();
  await expect(card.getByRole('button', { name: 'Grant the appeal' })).toBeFocused();
  await app.expectAccessible('admin, appeal confirmation');
});
