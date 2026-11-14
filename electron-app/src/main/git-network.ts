/**
 * Running git commands that talk to the remote.
 *
 * Every such command runs inside the global git mutex (see `gitMutex.ts`), so
 * one that never returns would queue every other RPC behind it. This module is
 * the single place that makes them safe to hold the mutex across:
 *
 * - a wall-clock timeout that kills the git child, plus git's own low-speed
 *   abort (`http.lowSpeedLimit` / `http.lowSpeedTime`) for stalled transfers;
 * - no interactive credential prompt of any kind: `GIT_TERMINAL_PROMPT=0`, no
 *   askpass helper, and an empty `credential.helper` so neither the user's
 *   `~/.gitconfig` nor the bundled git's system config is consulted. The app
 *   authenticates through `http.extraheader` alone; when that is rejected the
 *   command must fail, not fall back to something that blocks.
 */

export interface NetworkExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The timeout fired and the git child was killed. */
  timedOut?: boolean;
}

/**
 * Wall-clock caps, per kind of command. They are a backstop for a transfer that
 * keeps trickling bytes (the low-speed abort catches one that has stopped), so
 * they are generous: a slow connection pushing PDFs must not be cut off while
 * it is making progress.
 */
export const NETWORK_GIT_TIMEOUTS_MS = {
  fetch: 2 * 60_000,
  pushPull: 5 * 60_000,
  clone: 15 * 60_000,
} as const;

export type NetworkGitKind = keyof typeof NETWORK_GIT_TIMEOUTS_MS;

/** Abort a transfer slower than 1 kB/s for 30 s. */
const LOW_SPEED_LIMIT_BYTES = 1000;
const LOW_SPEED_TIME_SECONDS = 30;

/**
 * Environment that keeps git from ever asking a person for credentials.
 * Empty askpass values are deliberate: git ignores an empty program name, and
 * an empty `GIT_ASKPASS` also shadows `SSH_ASKPASS`.
 */
export const NO_PROMPT_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
  GCM_INTERACTIVE: 'never',
};

/**
 * Returns `git -c` args that authenticate HTTPS requests via an
 * `Authorization: Basic` header. The header lives only on the command line
 * for that single git invocation — it is never written to `.git/config`,
 * so a force-kill can't leak the token to disk, and concurrent reads of
 * `git remote get-url origin` always see a clean URL.
 */
export function gitAuthArgs(token: string | null): string[] {
  if (!token) return [];
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.extraheader=Authorization: Basic ${auth}`];
}

/** `git -c` args every network command gets, before the subcommand. */
export function networkGitArgs(token: string | null): string[] {
  return [
    '-c',
    'credential.helper=',
    '-c',
    `http.lowSpeedLimit=${LOW_SPEED_LIMIT_BYTES}`,
    '-c',
    `http.lowSpeedTime=${LOW_SPEED_TIME_SECONDS}`,
    ...gitAuthArgs(token),
  ];
}

/**
 * Run a git command that talks to the remote.
 *
 * `args` is the subcommand and its arguments (no `-c` options). When the
 * timeout fires the git child is killed and the result has `timedOut: true`;
 * callers report that as an OFFLINE-class failure.
 */
export async function execNetworkGit(
  args: string[],
  cwd: string,
  options: { token: string | null; kind: NetworkGitKind },
): Promise<NetworkExecResult> {
  const { exec } = await import('dugite');

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, NETWORK_GIT_TIMEOUTS_MS[options.kind]);

  try {
    return await exec([...networkGitArgs(options.token), ...args], cwd, {
      env: NO_PROMPT_ENV,
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) {
      const partial = err as { stdout?: unknown; stderr?: unknown };
      return {
        exitCode: -1,
        stdout: typeof partial.stdout === 'string' ? partial.stdout : '',
        stderr: typeof partial.stderr === 'string' ? partial.stderr : '',
        timedOut: true,
      };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
