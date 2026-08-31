import { defineConfig } from '@playwright/test';

const isPackaged = process.env.COLREV_TEST_MODE === 'packaged';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  testMatch: /specs\/.*\.spec\.ts$/,
  // Packaged builds boot the python-build-standalone interpreter on a cold
  // disk (Gatekeeper checks, colrev imports). Give them more headroom.
  timeout: isPackaged ? 180_000 : 90_000,
  // One retry in CI (WP-08 §4). At `retries: 0` a single flake reds the whole
  // suite, which trains people to ignore it; with a retry the flake is still
  // visible — a retried test is reported as "flaky", and the count is in the
  // HTML report — but a real regression still fails the run. Locally we keep
  // 0 so a flake is felt immediately.
  retries: isCI ? 1 : 0,
  // Electron tests must run serially: each spec launches its own Electron
  // process and Python backend, and the fixture's workspaces live under a
  // shared /tmp root. Parallelism here is a CI-matrix decision (one spec per
  // job), not a worker-count one — see e2e/README.md.
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  outputDir: 'test-results/',
});
