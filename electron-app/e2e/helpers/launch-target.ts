import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves WHAT the e2e/smoke fixtures launch.
 *
 * Two modes, selected by COLREV_TEST_MODE:
 *   dev      (default) — the electron binary from node_modules running
 *              dist/main/index.js. The Python backend comes from the conda
 *              colrev env on the host.
 *   packaged — the actual electron-builder output (ColRev.app / ColRev.exe).
 *              Everything must come from the package: the bundled
 *              python-build-standalone interpreter, the bundled dugite git,
 *              the asar'd main/renderer code. The fixture deliberately does
 *              NOT inject the conda env in this mode.
 *
 * COLREV_PACKAGED_APP overrides the binary location (accepts either the
 * executable itself or a mac .app bundle directory).
 */

export type TestMode = 'dev' | 'packaged';

const APP_ROOT = path.join(__dirname, '../..');

export function resolveTestMode(env: NodeJS.ProcessEnv = process.env): TestMode {
  return env.COLREV_TEST_MODE === 'packaged' ? 'packaged' : 'dev';
}

/** Default electron-builder output path for the current platform. */
export function defaultPackagedBinary(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const release = path.join(APP_ROOT, 'release');
  switch (platform) {
    case 'darwin': {
      const dir = arch === 'arm64' ? 'mac-arm64' : 'mac';
      return path.join(release, dir, 'ColRev.app', 'Contents', 'MacOS', 'ColRev');
    }
    case 'win32':
      return path.join(release, 'win-unpacked', 'ColRev.exe');
    default:
      return path.join(release, 'linux-unpacked', 'colrev');
  }
}

export interface LaunchTarget {
  mode: TestMode;
  /**
   * Absolute path to the packaged executable. Undefined in dev mode —
   * Playwright then uses the electron module's binary.
   */
  executablePath?: string;
  /** Args that identify the app (dev: path to dist/main/index.js). */
  args: string[];
}

export function resolveLaunchTarget(env: NodeJS.ProcessEnv = process.env): LaunchTarget {
  const mode = resolveTestMode(env);

  if (mode === 'dev') {
    return { mode, args: [path.join(APP_ROOT, 'dist/main/index.js')] };
  }

  let binary = env.COLREV_PACKAGED_APP ?? defaultPackagedBinary();
  if (binary.endsWith('.app')) {
    // Convenience: accept the .app bundle and derive the inner executable.
    binary = path.join(binary, 'Contents', 'MacOS', 'ColRev');
  }

  if (!fs.existsSync(binary)) {
    throw new Error(
      `COLREV_TEST_MODE=packaged but no packaged app at:\n  ${binary}\n` +
        'Build one first:\n' +
        '  npm run release:mac:unsigned   (full: python bundle + build + package)\n' +
        '  npm run release:mac:fast       (reuse existing python bundle)\n' +
        'or point COLREV_PACKAGED_APP at an existing build.',
    );
  }

  return { mode, executablePath: binary, args: [] };
}
