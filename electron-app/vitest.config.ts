import { resolve } from 'path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': resolve(__dirname, 'src/renderer'),
};

/**
 * Two projects, split by the environment a test actually needs (WP-08 §1).
 *
 * - `node`: main process, preload, e2e library code, and the pure renderer
 *   `lib/` modules. No DOM setup cost.
 * - `dom`: renderer stores, composables and components. Runs under happy-dom
 *   with a typed `window.*` bridge mock installed per test file (see
 *   `src/renderer/test/`), so store code that reads `window.colrev` /
 *   `window.git` / `window.gitState` is exercisable headlessly instead of
 *   only through Playwright.
 *
 * Run both with `npm test`; a single one with `npm test -- --project=dom`.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          // Several files here shell out to real git (the e2e seeders, the
          // fake GitHub client's bare remotes, the client contract suite).
          // Vitest runs files in parallel, so those processes compete; the
          // default 5s is tight enough that a loaded machine turns honest
          // work into a timeout. Raise it rather than accept a flaky suite.
          testTimeout: 30_000,
          include: [
            'src/main/**/*.test.ts',
            'src/preload/**/*.test.ts',
            'src/renderer/lib/**/*.test.ts',
            'e2e/**/*.test.ts',
          ],
        },
      },
      {
        plugins: [vue()],
        resolve: { alias },
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['src/renderer/**/*.test.ts'],
          exclude: ['src/renderer/lib/**'],
          setupFiles: [resolve(__dirname, 'src/renderer/test/setup.ts')],
          // The debug store mirrors every RPC to the console; keep that for
          // failing tests only.
          silent: 'passed-only',
        },
      },
    ],
  },
});
