import { defineConfig } from '@playwright/test';

/**
 * Browser checks (Prompts 5.1, 5.2): axe-core on every view, sheet and panel,
 * the keyboard paths through them, offline, recovery and the error states,
 * against the production build (npm run test:e2e:build) served as Cloudflare
 * Pages would, production headers and all (scripts/e2e/serve.ts). The network
 * is answered by tests/e2e/fixtures, so no API Worker or database is needed.
 */

const PORT = 4180;
const E2E_CONNECT = 'http://supabase.e2e.test,ws://supabase.e2e.test';

/** WebGL without a GPU (CI): SwiftShader, which Chrome now asks to be allowed. */
const SOFTWARE_GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  // Software GL is CPU-bound: two at a time keeps each page responsive, on a
  // CI runner and on a laptop alike (more starved every page here).
  workers: 2,
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] !== undefined ? 1 : 0,
  reporter: process.env['CI'] !== undefined ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: { args: SOFTWARE_GL },
    // The offline shell would answer requests that page.route must see; the
    // offline checks turn it back on for themselves.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    {
      name: 'phone',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    // The e2e build's stand-in Supabase joins the CSP's connect-src, as only these checks need.
    command: `node --experimental-strip-types scripts/e2e/serve.ts --port ${PORT} --connect ${E2E_CONNECT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 60_000,
  },
});
