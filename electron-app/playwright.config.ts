import { defineConfig } from '@playwright/test';

const isPackaged = process.env.COLREV_TEST_MODE === 'packaged';

export default defineConfig({
  testDir: './e2e',
  testMatch: /specs\/.*\.spec\.ts$/,
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
});
