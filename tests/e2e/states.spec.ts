import { CLOSED_DISCUSSION_SEQ, nodesPayload } from './fixtures/news';
import { expect, test } from './fixtures/app';

/**
 * Prompt 5.2: every way the news can be missing or gone says so, offers the
 * one thing to do about it, and passes axe.
 */

test.describe('error and empty states', () => {
  test('no stories yet', async ({ app }) => {
    await app.open({ news: 'empty' });
    await expect(app.page.getByTestId('news-problem')).toContainText('No stories yet');
    await app.expectAccessible('no stories');
  });

  test('the list says so too', async ({ app }) => {
    await app.open({ news: 'empty', layout: 'list' });
    await expect(app.page.getByText('No stories yet.')).toBeVisible();
  });

  test('the news cannot load: it counts down, and Try now loads it', async ({ app }) => {
    await app.open({ news: 'failing' });
    const card = app.page.getByTestId('news-problem');
    await expect(card).toContainText('The news can’t load right now', { timeout: 20_000 });
    await expect(card).toContainText(/Trying again in \d+ s/);
    await app.expectAccessible('news failed');

    // The page keeps retrying on its own, so Try now is pressed with time to
    // spare on the countdown: the request that follows is the button's.
    let back = false;
    await app.page.route('**/api/nodes?*', (route) =>
      back
        ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(nodesPayload()) })
        : route.fulfill({ status: 503, body: '' }),
    );
    await expect(card).toContainText(/Trying again in ([4-9]|\d{2,}) s/, { timeout: 60_000 });
    // Its answer, not just the request: the route must have answered 503 before `back` turns.
    const asked = app.page.waitForResponse(
      (response) => response.url().includes('/api/nodes?') && response.status() === 503,
      { timeout: 3000 },
    );
    await card.getByRole('button', { name: 'Try now' }).click();
    await asked;

    back = true;
    await card.getByRole('button', { name: 'Try now' }).click();
    await expect(app.page.getByText(/120 stories/).first()).toBeVisible({ timeout: 20_000 });
    await expect(card).toBeHidden();
  });

  test('a story that has gone, and the way back', async ({ app }) => {
    await app.open({ path: '/?story=99999', news: 'stories' });
    const heading = app.page.getByRole('heading', { name: 'This story is no longer available.' });
    await expect(heading).toBeVisible({ timeout: 20_000 });
    await app.expectAccessible('story gone');
    await app.page.getByRole('button', { name: 'Back to the news' }).click();
    // A closed sheet slides away and is inert.
    await expect(app.page.locator('[data-story-sheet]')).toHaveAttribute('inert', '');
  });

  test('a closed discussion can be read, not joined', async ({ app }) => {
    await app.open({ path: `/?story=${CLOSED_DISCUSSION_SEQ}` });
    await app.page.getByRole('button', { name: 'Read the closed discussion' }).click();
    await expect(app.page.getByText('This discussion has closed.').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(app.page.getByRole('button', { name: /^Post/ })).toHaveCount(0);
    await app.expectAccessible('closed discussion');
  });
});
