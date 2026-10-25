import { expect, test } from './fixtures/app';

/**
 * Prompt 5.2: a browser that can make no WebGL context gets the flat map (a
 * 2D canvas), with a line saying why. Its own file: the browser is launched
 * without WebGL, which Playwright allows only for a whole file.
 */
test.use({ launchOptions: { args: ['--disable-webgl', '--disable-3d-apis'] } });

test('the flat map shows the news, and says why', async ({ app }) => {
  await app.open();
  await expect(app.page.getByTestId('globe-notice')).toContainText(
    'can’t draw the 3D globe, so the news is on a flat map',
  );
  await expect(app.page.locator('[aria-roledescription="map"]')).toBeVisible();
  await expect(app.page.locator('[aria-roledescription="globe"]')).toHaveCount(0);
  await app.expectAccessible('no WebGL, flat map');
});
