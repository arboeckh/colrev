/**
 * Git operations manager using dugite.
 * Handles branch management, fetch/pull/push, and authenticated operations.
 * Reuses the token-auth pattern from github-manager.ts.
 */

import { execNetworkGit, type NetworkExecResult } from './git-network';

export interface BranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  lastCommitDate?: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitResult {
  success: boolean;
  error?: string;
}

/**
 * Structured `error` values. Callers branch on these instead of matching
 * stderr strings, so the renderer can offer a specific recovery instead of
 * surfacing raw git output.
 */
export const DIRTY_WORKTREE = 'DIRTY_WORKTREE';
export const DIVERGED = 'DIVERGED';
/** Remote moved on: the push needs a pull/fetch first. */
export const REJECTED_FETCH_FIRST = 'REJECTED_FETCH_FIRST';
/** Credentials rejected — the stored token is expired or lacks scope. */
export const AUTH_FAILED = 'AUTH_FAILED';
/** The remote was unreachable (DNS, connect, or a dropped connection). */
export const OFFLINE = 'OFFLINE';

export type GitFailureCode =
  | typeof DIRTY_WORKTREE
  | typeof DIVERGED
  | typeof REJECTED_FETCH_FIRST
  | typeof AUTH_FAILED
  | typeof OFFLINE;

/**
 * Offline shapes dugite's own `HostDown` regex misses — it only matches
 * `Host is down` and clone's `Could not resolve host`, so every other
 * transport failure would otherwise reach the user as raw stderr.
 */
const OFFLINE_STDERR_PATTERNS: RegExp[] = [
  /Could not resolve host/i,
  /Could not resolve proxy/i,
  /Temporary failure in name resolution/i,
  /unable to access '[^']*': (Failed to connect|Connection (refused|timed out|reset)|Could ?n[o']?t connect to server|Operation timed out|Operation too slow|Network is unreachable|Empty reply from server|SSL connect error)/i,
  /fatal: unable to look up/i,
];

/**
 * Map a failed git invocation onto one of the structured codes above.
 *
 * dugite's `parseError` is the primary source — it recognises the exact
 * wording git uses per version — with the pattern list above filling the gaps
 * for transport failures. Returns null when the failure has no actionable
 * classification; callers surface stderr in that case.
 */
/**
 * A rejected or missing credential. With prompts disabled, git answers a
 * rejected `http.extraheader` token with "could not read Username" (it fell
 * back to asking) rather than its own "Authentication failed" wording.
 */
const AUTH_STDERR_PATTERNS: RegExp[] = [
  /could not read (Username|Password) for/i,
  /terminal prompts disabled/i,
  /The requested URL returned error: (401|403)/i,
  /HTTP(?:\/[\d.]+)? 401\b/i,
];

export async function classifyGitFailure(
  stderr: string,
): Promise<GitFailureCode | null> {
  if (!stderr) return null;
  const { parseError, GitError } = await import('dugite');

  switch (parseError(stderr)) {
    case GitError.PushNotFastForward:
      return REJECTED_FETCH_FIRST;
    case GitError.HTTPSAuthenticationFailed:
    case GitError.SSHAuthenticationFailed:
    case GitError.SSHPermissionDenied:
      return AUTH_FAILED;
    case GitError.HostDown:
    case GitError.RemoteDisconnection:
      return OFFLINE;
    default:
      break;
  }

  if (AUTH_STDERR_PATTERNS.some((p) => p.test(stderr))) return AUTH_FAILED;
  if (OFFLINE_STDERR_PATTERNS.some((p) => p.test(stderr))) return OFFLINE;
  return null;
}

/**
 * Build the failure result for a command that talked to the remote: a
 * structured code when the failure is one the UI can act on, raw stderr
 * otherwise. A command killed by the network timeout is OFFLINE-class: the
 * remote did not answer in time.
 */
async function remoteFailure(
  result: Pick<NetworkExecResult, 'stderr' | 'timedOut'>,
  fallback: string,
): Promise<GitResult> {
  if (result.timedOut) return { success: false, error: OFFLINE };
  const code = await classifyGitFailure(result.stderr);
  // dugite's stderr is '' (never null) when git printed nothing: `||`, not `??`.
  return { success: false, error: code || result.stderr || fallback };
}

export interface GitCheckoutResult extends GitResult {
  /** Populated when `error === DIRTY_WORKTREE`. */
  dirty?: { uncommittedCount: number; untrackedCount: number };
}

export interface GitBranchListResult extends GitResult {
  branches: BranchInfo[];
  currentBranch: string;
}

export interface GitLogResult extends GitResult {
  commits: GitLogEntry[];
}

export interface GitDirtyState extends GitResult {
  isDirty: boolean;
  uncommittedCount: number;
  untrackedCount: number;
}

/** A fetch result that also says whether it moved any remote-tracking ref. */
export interface GitFetchResult extends GitResult {
  refsChanged?: boolean;
}

async function remoteRefSnapshot(projectPath: string): Promise<string | null> {
  const { exec } = await import('dugite');
  const result = await exec(
    ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/remotes/origin'],
    projectPath,
  );
  return result.exitCode === 0 ? result.stdout : null;
}

export async function gitFetch(
  projectPath: string,
  token: string | null = null,
): Promise<GitFetchResult> {
  const before = await remoteRefSnapshot(projectPath);
  const result = await execNetworkGit(['fetch', '--prune', 'origin'], projectPath, {
    token,
    kind: 'fetch',
  });
  if (result.exitCode !== 0) {
    return remoteFailure(result, 'Fetch failed');
  }
  const after = await remoteRefSnapshot(projectPath);
  // Unknown (a for-each-ref failed) counts as moved: the caller refreshes on it.
  return { success: true, refsChanged: before === null || after === null || before !== after };
}

export async function gitPull(
  projectPath: string,
  token: string | null = null,
  ffOnly = true,
): Promise<GitResult> {
  const args = ['pull', 'origin'];
  if (ffOnly) args.push('--ff-only');
  const result = await execNetworkGit(args, projectPath, { token, kind: 'pushPull' });
  if (result.exitCode !== 0) {
    const stderr = result.stderr || '';
    if (stderr.includes('Not possible to fast-forward') || stderr.includes('fatal: Not possible')) {
      return { success: false, error: DIVERGED };
    }
    if (
      stderr.includes('would be overwritten by merge') ||
      stderr.includes('Please commit your changes or stash them')
    ) {
      return { success: false, error: DIRTY_WORKTREE };
    }
    return remoteFailure(result, 'Pull failed');
  }
  return { success: true };
}

export async function gitPush(
  projectPath: string,
  token: string | null = null,
): Promise<GitResult> {
  // --no-verify: skip pre-commit pre-push hook. In the packaged app the
  // hook's INSTALL_PYTHON is the PyInstaller bundle, not a real Python,
  // and crashes when invoked with `-mpre_commit hook-impl …`.
  const result = await execNetworkGit(
    ['push', '--no-verify', '-u', 'origin', 'HEAD'],
    projectPath,
    { token, kind: 'pushPull' },
  );
  if (result.exitCode !== 0) {
    // Classified so the renderer can say "Pull first" / "Sign in again" /
    // "You're offline" instead of pasting stderr into a toast.
    return remoteFailure(result, 'Push failed');
  }
  return { success: true };
}

export async function gitPushBranch(
  projectPath: string,
  branchName: string,
  token: string | null = null,
): Promise<GitResult> {
  const result = await execNetworkGit(
    ['push', '--no-verify', '-u', 'origin', `${branchName}:${branchName}`],
    projectPath,
    { token, kind: 'pushPull' },
  );
  if (result.exitCode !== 0) {
    return remoteFailure(result, `Failed to push ${branchName}`);
  }
  return { success: true };
}

/**
 * Delete a branch on the remote.
 *
 * Used to retire reviewer branches once their decisions are reconciled into
 * dev. A branch that is already gone is success, not failure — cleanup runs
 * after every reconciliation and must be idempotent.
 */
export async function gitDeleteRemoteBranch(
  projectPath: string,
  branchName: string,
  token: string | null = null,
): Promise<GitResult> {
  const result = await execNetworkGit(
    ['push', '--no-verify', 'origin', '--delete', branchName],
    projectPath,
    { token, kind: 'pushPull' },
  );
  if (result.exitCode !== 0) {
    const stderr = result.stderr || '';
    if (/remote ref does not exist|unable to delete '[^']*': remote ref does not exist/i.test(stderr)) {
      return { success: true };
    }
    return remoteFailure(result, `Failed to delete ${branchName} on the remote`);
  }
  return { success: true };
}

export async function gitListBranches(
  projectPath: string,
): Promise<GitBranchListResult> {
  const { exec } = await import('dugite');

  // Get current branch
  const headResult = await exec(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
  const currentBranch = headResult.exitCode === 0 ? headResult.stdout.trim() : 'main';

  // List all branches with details
  const result = await exec(
    ['branch', '-a', '--format=%(refname)\t%(upstream:short)\t%(upstream:track)\t%(committerdate:iso8601)'],
    projectPath,
  );

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr, branches: [], currentBranch };
  }

  const branches: BranchInfo[] = [];
  const lines = result.stdout.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    const [refname, upstream, track, date] = line.split('\t');

    // Full refnames, because `%(refname:short)` prints the symbolic ref
    // `refs/remotes/origin/HEAD` as plain `origin`, which would pass for a
    // local branch of that name. Skip it, and a detached HEAD's "(HEAD
    // detached at …)" entry, which has no ref at all.
    if (/^refs\/remotes\/[^/]+\/HEAD$/.test(refname)) continue;
    const name = refname.startsWith('refs/heads/')
      ? refname.slice('refs/heads/'.length)
      : refname.startsWith('refs/remotes/')
        ? refname.slice('refs/remotes/'.length)
        : null;
    if (name === null) continue;

    const isRemote = name.startsWith('origin/');
    const localName = isRemote ? name.replace('origin/', '') : name;

    // Skip remote branches that have a local counterpart
    if (isRemote && branches.some((b) => b.name === localName && !b.remote)) {
      continue;
    }

    // Parse ahead/behind from track string like "[ahead 2, behind 1]"
    let ahead = 0;
    let behind = 0;
    if (track) {
      const aheadMatch = track.match(/ahead (\d+)/);
      const behindMatch = track.match(/behind (\d+)/);
      if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
      if (behindMatch) behind = parseInt(behindMatch[1], 10);
    }

    branches.push({
      name: localName,
      current: localName === currentBranch,
      remote: isRemote,
      upstream: upstream || undefined,
      ahead,
      behind,
      lastCommitDate: date || undefined,
    });
  }

  // Deduplicate: prefer local branches over remote-only
  const seen = new Set<string>();
  const deduped: BranchInfo[] = [];
  for (const b of branches) {
    if (!seen.has(b.name)) {
      seen.add(b.name);
      deduped.push(b);
    }
  }

  return { success: true, branches: deduped, currentBranch };
}

export async function gitCreateBranch(
  projectPath: string,
  name: string,
  baseBranch?: string,
): Promise<GitResult> {
  const { exec } = await import('dugite');

  // Create branch from base (or current HEAD)
  const args = ['checkout', '-b', name];
  if (baseBranch) args.push(baseBranch);

  const result = await exec(args, projectPath);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || `Failed to create branch ${name}` };
  }
  return { success: true };
}

export async function gitCreateLocalBranch(
  projectPath: string,
  name: string,
  baseRef: string,
): Promise<GitResult> {
  const { exec } = await import('dugite');
  const result = await exec(['branch', name, baseRef], projectPath);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || `Failed to create branch ${name}` };
  }
  return { success: true };
}

export async function gitDeleteLocalBranch(
  projectPath: string,
  name: string,
): Promise<GitResult> {
  const { exec } = await import('dugite');
  const result = await exec(['branch', '-D', name], projectPath);
  if (result.exitCode !== 0) {
    const stderr = result.stderr || '';
    // Idempotent: retiring reviewer branches runs after every reconciliation,
    // and a branch that was never fetched locally is already in the state we
    // want.
    if (/not found|branch .* not found/i.test(stderr)) {
      return { success: true };
    }
    return { success: false, error: stderr || `Failed to delete branch ${name}` };
  }
  return { success: true };
}

/**
 * Check out ``branchName``.
 *
 * Refuses outright when the working tree is dirty: returns
 * ``{ success: false, error: 'DIRTY_WORKTREE', dirty: {...} }`` so the
 * renderer can offer an explicit save-or-discard choice.
 *
 * There is deliberately no stash fallback. The managed-review decision flow
 * keeps `records.bib` dirty between decisions by design, and an auto-stash
 * that is never popped silently strands those decisions. Letting git carry
 * the changes across instead is no better — reviewer decisions would land on
 * whichever branch the user switched to. Both outcomes are data loss from the
 * user's point of view, so the switch is the user's call to make.
 *
 * A checkout of the branch already in HEAD is a no-op and stays allowed even
 * when dirty — nothing moves, so nothing can be lost.
 */
export async function gitCheckout(
  projectPath: string,
  branchName: string,
): Promise<GitCheckoutResult> {
  const { exec } = await import('dugite');

  const head = await exec(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
  if (head.exitCode === 0 && head.stdout.trim() === branchName) {
    return { success: true };
  }

  const dirty = await gitGetDirtyState(projectPath);
  if (dirty.success && dirty.isDirty) {
    return {
      success: false,
      error: DIRTY_WORKTREE,
      dirty: {
        uncommittedCount: dirty.uncommittedCount,
        untrackedCount: dirty.untrackedCount,
      },
    };
  }

  // Check for local branch first, then try remote tracking
  const localCheck = await exec(['rev-parse', '--verify', branchName], projectPath);
  if (localCheck.exitCode !== 0) {
    // Try to create local tracking branch from remote
    const trackResult = await exec(
      ['checkout', '-b', branchName, `origin/${branchName}`],
      projectPath,
    );
    if (trackResult.exitCode !== 0) {
      return {
        success: false,
        error: trackResult.stderr || `Branch ${branchName} not found`,
      };
    }
    return { success: true };
  }

  const result = await exec(['checkout', branchName], projectPath);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || `Failed to checkout ${branchName}` };
  }
  return { success: true };
}

export async function gitMerge(
  projectPath: string,
  source: string,
  ffOnly = true,
): Promise<GitResult> {
  const { exec } = await import('dugite');

  const args = ['merge', source];
  if (ffOnly) args.push('--ff-only');

  const result = await exec(args, projectPath);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || `Failed to merge ${source}` };
  }
  return { success: true };
}

export async function gitLog(
  projectPath: string,
  count = 20,
): Promise<GitLogResult> {
  const { exec } = await import('dugite');

  const result = await exec(
    ['log', `--max-count=${count}`, '--format=%H\t%h\t%s\t%an\t%ci'],
    projectPath,
  );

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr, commits: [] };
  }

  const commits: GitLogEntry[] = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, message, author, date] = line.split('\t');
      return { hash, shortHash, message, author, date };
    });

  return { success: true, commits };
}

export async function gitGetDirtyState(
  projectPath: string,
): Promise<GitDirtyState> {
  const { exec } = await import('dugite');

  const result = await exec(['status', '--porcelain'], projectPath);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr, isDirty: false, uncommittedCount: 0, untrackedCount: 0 };
  }

  const lines = result.stdout.trim().split('\n').filter(Boolean);
  const untracked = lines.filter((l) => l.startsWith('??')).length;
  const modified = lines.length - untracked;

  return {
    success: true,
    isDirty: lines.length > 0,
    uncommittedCount: modified,
    untrackedCount: untracked,
  };
}

export async function gitAbortMerge(
  projectPath: string,
): Promise<GitResult> {
  const { exec } = await import('dugite');
  const result = await exec(['merge', '--abort'], projectPath);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Failed to abort merge' };
  }
  return { success: true };
}

export async function gitCreateTag(
  projectPath: string,
  tagName: string,
  message: string,
): Promise<GitResult> {
  const { exec } = await import('dugite');
  const result = await exec(['tag', '-a', tagName, '-m', message], projectPath);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || `Failed to create tag ${tagName}` };
  }
  return { success: true };
}

export async function gitPushTags(
  projectPath: string,
  token: string | null = null,
): Promise<GitResult> {
  const result = await execNetworkGit(
    ['push', '--no-verify', 'origin', '--tags'],
    projectPath,
    { token, kind: 'pushPull' },
  );
  if (result.exitCode !== 0) {
    return remoteFailure(result, 'Failed to push tags');
  }
  return { success: true };
}

export async function gitRevListCount(
  projectPath: string,
  from: string,
  to: string,
): Promise<{ success: boolean; count: number; error?: string }> {
  const { exec } = await import('dugite');
  const result = await exec(['rev-list', '--count', `${from}..${to}`], projectPath);
  if (result.exitCode !== 0) {
    return { success: false, count: 0, error: result.stderr || 'rev-list failed' };
  }
  return { success: true, count: parseInt(result.stdout.trim(), 10) || 0 };
}

// --- Merge conflict resolution helpers ---

/**
 * Resolve the current branch and its upstream tracking ref. The
 * divergence-merge flow merges against the actual upstream of whatever
 * branch is checked out — never a hardcoded remote ref.
 */
export async function gitGetBranchAndUpstream(
  projectPath: string,
): Promise<{ success: boolean; branch?: string; upstream?: string; error?: string }> {
  const { exec } = await import('dugite');

  const headResult = await exec(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
  if (headResult.exitCode !== 0) {
    return { success: false, error: headResult.stderr || 'Could not determine current branch' };
  }
  const branch = headResult.stdout.trim();

  const upstreamResult = await exec(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    projectPath,
  );
  if (upstreamResult.exitCode !== 0) {
    return {
      success: false,
      branch,
      error: `Branch '${branch}' has no upstream tracking branch`,
    };
  }
  return { success: true, branch, upstream: upstreamResult.stdout.trim() };
}

export async function gitHasMergeConflict(
  projectPath: string,
): Promise<boolean> {
  const { exec } = await import('dugite');
  const result = await exec(['rev-parse', '--verify', 'MERGE_HEAD'], projectPath);
  return result.exitCode === 0;
}

/**
 * Fast-forward local ``main`` to ``origin/main`` without requiring a checkout.
 *
 * Used when a collaborator has pushed to ``main`` while the user is working on
 * ``dev``. Refuses when local ``main`` has diverged (has commits that aren't
 * in ``origin/main``) — callers should fall back to a normal pull after
 * checking out main.
 */
export async function gitFastForwardMain(
  projectPath: string,
  token: string | null = null,
): Promise<GitResult> {
  const { exec } = await import('dugite');

  const fetchRes = await execNetworkGit(['fetch', '--prune', 'origin'], projectPath, {
    token,
    kind: 'fetch',
  });
  if (fetchRes.exitCode !== 0) {
    return remoteFailure(fetchRes, 'Fetch failed');
  }

  const ancestorRes = await exec(
    ['merge-base', '--is-ancestor', 'main', 'origin/main'],
    projectPath,
  );
  if (ancestorRes.exitCode === 1) {
    // Exit code 1 means "not an ancestor" → local main has diverged.
    return { success: false, error: DIVERGED };
  }
  if (ancestorRes.exitCode !== 0) {
    // Anything else (128: an unknown ref) is not divergence: local `main` or
    // `origin/main` does not exist, which the UI must not call a divergence.
    return {
      success: false,
      error: ancestorRes.stderr.trim() || "Cannot fast-forward main: 'main' or 'origin/main' is missing",
    };
  }

  // Check current branch — if on main, use a plain pull-equivalent so
  // the working tree updates too.
  const headRes = await exec(
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    projectPath,
  );
  const currentBranch = headRes.stdout.trim();

  if (currentBranch === 'main') {
    const pullRes = await exec(
      ['merge', '--ff-only', 'origin/main'],
      projectPath,
    );
    if (pullRes.exitCode !== 0) {
      return { success: false, error: pullRes.stderr || 'Fast-forward failed' };
    }
    return { success: true };
  }

  // Off-main: move the ref without touching the working tree.
  const updateRes = await exec(
    ['update-ref', 'refs/heads/main', 'refs/remotes/origin/main'],
    projectPath,
  );
  if (updateRes.exitCode !== 0) {
    return { success: false, error: updateRes.stderr || 'update-ref failed' };
  }
  return { success: true };
}

/**
 * Clone a repository. Auth via http.extraheader so the token never lands
 * in `.git/config`; the cloned repo's origin is the clean URL automatically.
 */
export async function gitClone(
  cloneUrl: string,
  targetPath: string,
  token: string | null,
): Promise<GitResult> {
  const path = await import('path');

  const parentDir = path.dirname(targetPath);

  const result = await execNetworkGit(['clone', cloneUrl, targetPath], parentDir, {
    token,
    kind: 'clone',
  });
  if (result.exitCode !== 0) {
    return remoteFailure(result, 'Clone failed');
  }

  return { success: true };
}
