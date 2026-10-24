import { defineConfig } from '@playwright/test';

/**
 * Browser checks (Prompt 5.1): axe-core on every view, sheet and panel, and
 * the keyboard paths through them, against the production build
 * (npm run test:e2e:build) served by vite preview. The network is answered
 * by tests/e2e/fixtures, so no API Worker or database is needed.
 */

const PORT = 4180;

/** WebGL without a GPU (CI): SwiftShader, which Chrome now asks to be allowed. */
const SOFTWARE_GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  // Software GL is CPU-bound: two at a time keeps each page responsive on a CI runner.
  workers: process.env['CI'] !== undefined ? 2 : '50%',
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] !== undefined ? 1 : 0,
  reporter: process.env['CI'] !== undefined ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: { args: SOFTWARE_GL },
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
    command: `npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 60_000,
  },
});
