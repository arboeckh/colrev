import * as path from 'path';
import { app } from 'electron';

/**
 * Setup Git environment using dugite's bundled Git.
 *
 * dugite bundles Git binaries that work across platforms.
 * We need to set PATH and GIT_EXEC_PATH so that the colrev-jsonrpc
 * subprocess can find and use Git.
 */
export function setupGitEnvironment(): Record<string, string> {
  // dugite stores its Git binaries in node_modules/dugite/git
  // In packaged app, they're in app.asar.unpacked or resources

  let dugiteGitPath: string;

  if (app.isPackaged) {
    // In packaged app, Git binaries are in resources/git (via extraResources)
    dugiteGitPath = path.join(process.resourcesPath, 'git');
  } else {
    // In development, use node_modules directly
    dugiteGitPath = path.join(
      __dirname,
      '../../..',
      'node_modules',
      'dugite',
      'git'
    );
  }

  // Platform-specific paths
  const platform = process.platform;
  let gitBinPath: string;
  let gitExecPath: string;

  if (platform === 'darwin') {
    // macOS
    gitBinPath = path.join(dugiteGitPath, 'bin');
    gitExecPath = path.join(dugiteGitPath, 'libexec', 'git-core');
  } else if (platform === 'win32') {
    // Windows
    gitBinPath = path.join(dugiteGitPath, 'cmd');
    gitExecPath = path.join(dugiteGitPath, 'mingw64', 'libexec', 'git-core');
  } else {
    // Linux
    gitBinPath = path.join(dugiteGitPath, 'bin');
    gitExecPath = path.join(dugiteGitPath, 'libexec', 'git-core');
  }

  // Prepend Git to PATH
  const currentPath = process.env.PATH || '';
  const newPath = `${gitBinPath}${path.delimiter}${currentPath}`;

  return {
    PATH: newPath,
    GIT_EXEC_PATH: gitExecPath,
    // Disable Git's pager for subprocess use
    GIT_PAGER: '',
    // Ensure Git doesn't prompt for credentials interactively
    GIT_TERMINAL_PROMPT: '0',
  };
}

/**
 * Check if Git is available (for diagnostics).
 */
export async function checkGitAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
  const { exec } = await import('dugite');

  try {
    const result = await exec(['--version'], process.cwd());
    if (result.exitCode === 0) {
      return {
        available: true,
        version: result.stdout.trim(),
      };
    }
    return {
      available: false,
      error: result.stderr || 'Git exited with non-zero code',
    };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
