import * as path from 'path';

/**
 * Where the colrev JSON-RPC server lives and what environment it needs.
 *
 * Dev: run `python -m colrev.ui_jsonrpc.server` against whatever Python is on
 * PATH (typically the conda colrev env).
 * Packaged: spawn the console-script shim from the python-build-standalone
 * bundle (macOS), or the bundle's python.exe with the module (Windows).
 */
export interface BackendLaunchInput {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  /** Electron's `process.resourcesPath`. Only read when packaged. */
  resourcesPath: string;
  /** Environment produced by `setupGitEnvironment()`. */
  gitEnv: Record<string, string>;
  /** Electron's `app.getPath('userData')`. */
  userDataDir: string;
  /** Process environment, for the test-mode switches. */
  env: NodeJS.ProcessEnv;
}

export interface BackendLaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function resolveBackendLaunch(input: BackendLaunchInput): BackendLaunchSpec {
  const isWindows = input.platform === 'win32';

  let command: string;
  let args: string[];
  let bundleBinDir: string | null = null;

  if (!input.isPackaged) {
    command = isWindows ? 'python.exe' : 'python';
    args = ['-m', 'colrev.ui_jsonrpc.server'];
  } else {
    const platformDir = isWindows ? 'python-win-x64' : 'python-mac-arm64';
    const bundleRoot = path.join(input.resourcesPath, platformDir);
    bundleBinDir = path.join(bundleRoot, isWindows ? 'Scripts' : 'bin');
    if (isWindows) {
      // Not the Scripts\colrev-jsonrpc.cmd shim: Node refuses to spawn .cmd/.bat
      // files without `shell: true` (EINVAL, CVE-2024-27980), and going through
      // cmd.exe would mean quoting install paths with spaces. The shim only
      // runs this interpreter anyway.
      command = path.join(bundleRoot, 'python.exe');
      args = ['-m', 'colrev.ui_jsonrpc.server'];
    } else {
      command = path.join(bundleBinDir, 'colrev-jsonrpc');
      args = [];
    }
  }

  const env: Record<string, string> = { ...input.gitEnv };

  // Prepend the bundle's bin/Scripts dir to PATH so subprocess calls from
  // inside colrev (e.g. subprocess.check_call(["pre-commit", ...])) resolve to
  // the bundled shims rather than whatever happens to be on the host.
  if (bundleBinDir) {
    env.PATH = `${bundleBinDir}${path.delimiter}${env.PATH ?? input.env.PATH ?? ''}`;
  }

  if (input.env.COLREV_E2E_PINNED_DATES === '1') {
    const pinnedDate = '2025-01-01T00:00:00+00:00';
    env.GIT_AUTHOR_DATE = pinnedDate;
    env.GIT_COMMITTER_DATE = pinnedDate;
    env.COLREV_E2E_PINNED_DATES = '1';
  }

  // E2E mode: redirect HOME to the userData dir so colrev's
  // ~/.colrev/sqlite_index.db (LocalIndex) resolves inside the per-test
  // workspace instead of the developer's real home. Gated on the fake GitHub
  // registry env var so production is unaffected.
  if (input.env.COLREV_FAKE_GITHUB_REGISTRY) {
    env.HOME = input.userDataDir;
    // Python on Windows resolves `~` from USERPROFILE and ignores HOME.
    if (isWindows) env.USERPROFILE = input.userDataDir;
  }

  return { command, args, env };
}
