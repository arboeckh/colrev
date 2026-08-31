import { defineConfig } from '@playwright/test';

const isPackaged = process.env.COLREV_TEST_MODE === 'packaged';

export default defineConfig({
  testDir: './e2e',
  // Packaged builds boot the python-build-standalone interpreter on a cold
  // disk (Gatekeeper checks, colrev imports). Give them more headroom.
  timeout: isPackaged ? 180_000 : 90_000,
  retries: 0,
  workers: 1, // Electron tests must run serially
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  outputDir: 'test-results/',
  projects: [
    {
      // Full pipeline suite. Runs against the dev build by default; set
      // COLREV_TEST_MODE=packaged to run it against a packaged app.
      name: 'e2e',
      testMatch: /specs\/.*\.spec\.ts$/,
    },
    {
      // Fast packaged-app smoke suite (also runs against the dev build).
      name: 'smoke',
      testMatch: /smoke\/.*\.spec\.ts$/,
    },
  ],
});
