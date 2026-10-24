import type { Locator, Page } from '@playwright/test';

import { READER } from './fixtures/backend';
import { test, expect } from './fixtures/app';
import { OPEN_DISCUSSION_SEQ } from './fixtures/news';

/**
 * The keyboard paths (Prompt 5.1): through the globe's pins, the flat map,
 * the list, and in and out of every sheet and panel, with focus landing
 * where it should and coming back where it came from.
 */

/** What the globe or map said last: its polite live region. */
async function spoken(page: Page): Promise<string> {
  const texts = await page.getByRole('status').allTextContents();
  return texts.find((text) => / of \d+\.$/.test(text.trim()) || /Back to|Zooming/.test(text)) ?? '';
}

/**
 * Focuses the globe or map and Tabs onto its first pin, again until there
 * is one: the clusters arrive from their worker a moment after the stories.
 */
async function tabToFirstPin(page: Page, surface: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        await surface.focus();
        await page.keyboard.press('Tab');
        return spoken(page);
      },
      { timeout: 20_000 },
    )
    .toMatch(/ 1 of \d+\.$/);
}

test.describe('keyboard: the globe and the map', () => {
  for (const [view, reducedMotion, role] of [
    ['globe', false, 'globe'],
    ['flat map', true, 'map'],
  ] as const) {
    test(`${view}: Tab goes through the pins, Enter opens one, closing comes back`, async ({
      app,
    }) => {
      await app.open({ reducedMotion });
      const surface = app.page.locator(`[aria-roledescription="${role}"]`);
      await tabToFirstPin(app.page, surface);
      await expect(surface).toBeFocused();
      await app.page.keyboard.press('Tab');
      await expect.poll(() => spoken(app.page)).toMatch(/ 2 of \d+\.$/);
      await app.page.keyboard.press('Shift+Tab');
      await expect.poll(() => spoken(app.page)).toMatch(/ 1 of \d+\.$/);

      // Into clusters until a story is focused (each Enter zooms in), then open it.
      for (let i = 0; i < 8 && /stories, mostly/.test(await spoken(app.page)); i++) {
        await app.page.keyboard.press('Enter');
        await expect.poll(() => spoken(app.page)).toMatch(/Zooming in/);
        // The globe's flight takes a second or two, and the clusters reopen after it.
        await app.page.waitForTimeout(2500);
        await tabToFirstPin(app.page, surface);
      }
      await expect.poll(() => spoken(app.page)).not.toMatch(/stories, mostly/);
      await app.page.keyboard.press('Enter');
      const headline = app.page.locator('[data-story-sheet]').getByRole('heading', { level: 2 });
      await expect(headline).toBeFocused();

      await app.page.keyboard.press('Escape');
      await expect(surface).toBeFocused();
    });
  }

  test('the flat map moves with the arrow keys and zooms with + and −', async ({ app }) => {
    await app.open({ reducedMotion: true, path: '/?cam=0,0,4000' });
    const map = app.page.locator('[aria-roledescription="map"]');
    await tabToFirstPin(app.page, map);
    // Escape leaves the pin; then each key must change what the map shows.
    await app.page.keyboard.press('Escape');
    for (const key of ['ArrowRight', 'ArrowUp', '+', '-']) {
      const before = await map.screenshot();
      await app.page.keyboard.press(key);
      await expect.poll(async () => (await map.screenshot()).equals(before)).toBe(false);
    }
    await expect(map).toBeFocused();
  });

  test('Tab past the last pin leaves the globe', async ({ app }) => {
    await app.open({ path: '/?cam=0,0,20000' });
    const globe = app.page.locator('[aria-roledescription="globe"]');
    await globe.focus();
    for (let i = 0; i < 200; i++) {
      await app.page.keyboard.press('Tab');
      if (!(await globe.evaluate((element) => element === document.activeElement))) break;
    }
    await expect(globe).not.toBeFocused();
  });
});

test.describe('keyboard: the list', () => {
  test('arrows move between rows; a story opens and gives focus back to its row', async ({
    app,
  }) => {
    await app.open({ layout: 'list' });
    const rows = app.page.getByRole('list', { name: 'Stories' }).getByRole('button');
    await rows.first().focus();
    await app.page.keyboard.press('ArrowDown');
    await app.page.keyboard.press('ArrowDown');
    await expect(rows.nth(2)).toBeFocused();
    await app.page.keyboard.press('End');
    await expect(rows.last()).toBeFocused();
    await app.page.keyboard.press('Home');
    await expect(rows.first()).toBeFocused();

    await app.page.keyboard.press('ArrowDown');
    await app.page.keyboard.press('Enter');
    await expect(
      app.page.locator('[data-story-sheet]').getByRole('heading', { level: 2 }),
    ).toBeFocused();
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
    await app.page.keyboard.press('Escape');
    await expect(rows.nth(1)).toBeFocused();
  });

  test('Show more carries focus on to the first new row', async ({ app }) => {
    await app.open({ layout: 'list' });
    await app.page.getByRole('button', { name: /^Show \d+ more$/ }).click();
    await expect(
      app.page.getByRole('list', { name: 'Stories' }).getByRole('button').nth(50),
    ).toBeFocused();
  });
});

test.describe('keyboard: sheets and panels', () => {
  test('a modal sheet keeps Tab inside, and Escape gives focus back', async ({ app }) => {
    await app.open();
    const signIn = app.page.getByRole('button', { name: 'Sign in' });
    await signIn.focus();
    await app.page.keyboard.press('Enter');
    const sheet = app.page.getByRole('dialog', { name: /Sign in/ });
    await expect(sheet.getByRole('heading', { name: /Sign in/ })).toBeFocused();
    for (let i = 0; i < 12; i++) {
      await app.page.keyboard.press('Tab');
      expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      await app.page.keyboard.press('Shift+Tab');
      expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
    await expect(app.page.getByRole('banner')).toHaveAttribute('inert', '');
    await app.page.keyboard.press('Escape');
    await expect(signIn).toBeFocused();
  });

  test('the library: its tab takes focus, Escape returns it to the button', async ({ app }) => {
    await app.open();
    const following = app.page.getByRole('button', { name: 'Following' });
    await following.focus();
    await app.page.keyboard.press('Enter');
    await expect(app.page.getByRole('tab', { name: 'Following' })).toBeFocused();
    await app.page.keyboard.press('ArrowRight');
    await expect(app.page.getByRole('tab', { name: 'Saved' })).toBeFocused();
    await app.page.keyboard.press('Escape');
    await expect(following).toBeFocused();
  });

  test('the discussion keeps Tab inside, and leaving returns focus to Discuss', async ({ app }) => {
    await app.open({ path: `/?story=${OPEN_DISCUSSION_SEQ}`, persona: READER });
    const discuss = app.page.getByRole('button', { name: /Discuss|Join/ });
    await discuss.focus();
    await app.page.keyboard.press('Enter');
    const panel = app.page.getByRole('dialog', { name: /ferry/ });
    await expect(panel.getByRole('heading', { name: /ferry/ })).toBeFocused({ timeout: 30_000 });
    for (let i = 0; i < 40; i++) {
      await app.page.keyboard.press('Tab');
      expect(await panel.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
    await app.page.keyboard.press('Escape');
    await expect(discuss).toBeFocused();
  });

  test('a post menu closes when focus leaves it', async ({ app }) => {
    await app.open({ path: `/?story=${OPEN_DISCUSSION_SEQ}`, persona: READER });
    await app.page.getByRole('button', { name: /Discuss|Join/ }).click();
    const more = app.page.getByRole('button', { name: /More for @voice_1/ });
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    // Report, Block, then out of the menu.
    await app.page.keyboard.press('Tab');
    await app.page.keyboard.press('Tab');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
  });
});
