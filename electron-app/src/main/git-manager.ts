/**
 * Git operations manager using dugite.
 * Handles branch management, fetch/pull/push, and authenticated operations.
 * Reuses the token-auth pattern from github-manager.ts.
 */

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
  recovered?: boolean;
  recoveryMessage?: string;
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

/**
 * Temporarily set remote URL with token, run fn, then reset to clean URL.
 */
async function withTokenAuth<T>(
  projectPath: string,
  token: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (!token) return fn();

  const { exec } = await import('dugite');

  // Get current remote URL
  const urlResult = await exec(['remote', 'get-url', 'origin'], projectPath);
  if (urlResult.exitCode !== 0) {
    // No remote — just run without auth
    return fn();
  }
  const cleanUrl = urlResult.stdout.trim();

  // Build token URL
  const tokenUrl = cleanUrl.replace(
    /^https:\/\//,
    `https://x-access-token:${token}@`,
  );

  await exec(['remote', 'set-url', 'origin', tokenUrl], projectPath);
  try {
    return await fn();
  } finally {
    await exec(['remote', 'set-url', 'origin', cleanUrl], projectPath);
  }
}

export async function gitFetch(
  projectPath: string,
  token: string | null = null,
): Promise<GitResult> {
  const { exec } = await import('dugite');

  return withTokenAuth(projectPath, token, async () => {
    const result = await exec(['fetch', '--prune', 'origin'], projectPath);
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Fetch failed' };
    }
    return { success: true };
  });
}

export async function gitPull(
  projectPath: string,
  token: string | null = null,
  ffOnly = true,
): Promise<GitResult> {
  const { exec } = await import('dugite');

  return withTokenAuth(projectPath, token, async () => {
    const args = ['pull', 'origin'];
    if (ffOnly) args.push('--ff-only');
    const result = await exec(args, projectPath);
    if (result.exitCode !== 0) {
      const stderr = result.stderr || '';
      if (stderr.includes('Not possible to fast-forward') || stderr.includes('fatal: Not possible')) {
        return { success: false, error: 'DIVERGED' };
      }
      if (
        stderr.includes('would be overwritten by merge') ||
        stderr.includes('Please commit your changes or stash them')
      ) {
        return { success: false, error: 'DIRTY_WORKTREE' };
      }
      return { success: false, error: stderr || 'Pull failed' };
    }
    return { success: true };
  });
}

export async function gitPush(
  projectPath: string,
  token: string | null = null,
): Promise<GitResult> {
  const { exec } = await import('dugite');

  return withTokenAuth(projectPath, token, async () => {
    const result = await exec(['push', '-u', 'origin', 'HEAD'], projectPath);
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Push failed' };
    }
    return { success: true };
  });
}

export async function gitPushBranch(
  projectPath: string,
  branchName: string,
  token: string | null = null,
): Promise<GitResult> {
  const { exec } = await import('dugite');

  return withTokenAuth(projectPath, token, async () => {
    const result = await exec(['push', '-u', 'origin', `${branchName}:${branchName}`], projectPath);
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || `Failed to push ${branchName}` };
    }
    return { success: true };
  });
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
    ['branch', '-a', '--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)\t%(committerdate:iso8601)'],
    projectPath,
  );

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr, branches: [], currentBranch };
  }

  const branches: BranchInfo[] = [];
  const lines = result.stdout.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    const [name, upstream, track, date] = line.split('\t');

    // Skip origin/HEAD
    if (name.includes('HEAD')) continue;

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
    return { success: false, error: result.stderr || `Failed to delete branch ${name}` };
  }
  return { success: true };
}

export async function gitCheckout(
  projectPath: string,
  branchName: string,
): Promise<GitResult> {
  const { exec } = await import('dugite');

  const tryCheckout = async (args: string[]) => exec(args, projectPath);

  const isDirtyTreeError = (stderr: string) =>
    stderr.includes('would be overwritten by checkout') ||
    stderr.includes('would be overwritten by merge') ||
    stderr.includes('Please commit your changes or stash them');

  // Stash the dirty/untracked tree, retry the checkout, and report whether
  // the recovery succeeded. The stash is intentionally left in place so the
  // user can recover anything they care about with `git stash list/pop` —
  // auto-popping would just re-trigger the same conflict on the new branch.
  const recoverViaStash = async (
    checkoutArgs: string[],
    originalError: string,
  ): Promise<GitResult> => {
    const stashMessage = `colrev: auto-stash before switching to ${branchName} (${new Date().toISOString()})`;
    const stashResult = await exec(
      ['stash', 'push', '--include-untracked', '-m', stashMessage],
      projectPath,
    );
    if (stashResult.exitCode !== 0) {
      // Stash itself failed — surface the original checkout error, not the stash error.
      return { success: false, error: originalError };
    }

    const retry = await tryCheckout(checkoutArgs);
    if (retry.exitCode !== 0) {
      return { success: false, error: retry.stderr || originalError };
    }

    return {
      success: true,
      recovered: true,
      recoveryMessage:
        'Local changes were saved to a stash so the branch switch could complete.',
    };
  };

  // Check for local branch first, then try remote tracking
  const localCheck = await exec(['rev-parse', '--verify', branchName], projectPath);
  if (localCheck.exitCode !== 0) {
    // Try to create local tracking branch from remote
    const trackArgs = ['checkout', '-b', branchName, `origin/${branchName}`];
    const trackResult = await tryCheckout(trackArgs);
    if (trackResult.exitCode !== 0) {
      const trackErr = trackResult.stderr || `Branch ${branchName} not found`;
      if (isDirtyTreeError(trackResult.stderr)) {
        return recoverViaStash(trackArgs, trackErr);
      }
      return { success: false, error: trackErr };
    }
    return { success: true };
  }

  const checkoutArgs = ['checkout', branchName];
  const result = await tryCheckout(checkoutArgs);
  if (result.exitCode !== 0) {
    const err = result.stderr || `Failed to checkout ${branchName}`;
    if (isDirtyTreeError(result.stderr)) {
      return recoverViaStash(checkoutArgs, err);
    }
    return { success: false, error: err };
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

export async function gitAddAndCommit(
  projectPath: string,
  message: string,
): Promise<GitResult> {
  const { exec } = await import('dugite');

  const addResult = await exec(['add', '-A'], projectPath);
  if (addResult.exitCode !== 0) {
    return { success: false, error: addResult.stderr || 'git add failed' };
  }

  // Check if there's anything to commit
  const statusResult = await exec(['status', '--porcelain'], projectPath);
  if (statusResult.stdout.trim() === '') {
    return { success: true }; // Nothing to commit
  }

  const commitResult = await exec(['commit', '-m', message], projectPath);
  if (commitResult.exitCode !== 0) {
    return { success: false, error: commitResult.stderr || 'git commit failed' };
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
  const { exec } = await import('dugite');

  return withTokenAuth(projectPath, token, async () => {
    const result = await exec(['push', 'origin', '--tags'], projectPath);
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to push tags' };
    }
    return { success: true };
  });
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

export async function gitMergeBase(
  projectPath: string,
  ref1: string,
  ref2: string,
): Promise<{ success: boolean; commitHash?: string; error?: string }> {
  const { exec } = await import('dugite');
  const result = await exec(['merge-base', ref1, ref2], projectPath);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'No common ancestor found' };
  }
  return { success: true, commitHash: result.stdout.trim() };
}

export async function gitShowFile(
  projectPath: string,
  ref: string,
  filePath: string,
): Promise<{ success: boolean; content?: string; error?: string }> {
  const { exec } = await import('dugite');
  const result = await exec(['show', `${ref}:${filePath}`], projectPath);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || `File not found at ${ref}:${filePath}` };
  }
  return { success: true, content: result.stdout };
}

export async function gitDiffNameOnly(
  projectPath: string,
  ref1: string,
  ref2: string,
): Promise<{ success: boolean; files: string[]; error?: string }> {
  const { exec } = await import('dugite');
  const result = await exec(['diff', '--name-only', ref1, ref2], projectPath);
  if (result.exitCode !== 0) {
    return { success: false, files: [], error: result.stderr || 'Diff failed' };
  }
  const files = result.stdout.trim().split('\n').filter(Boolean);
  return { success: true, files };
}

export async function gitMergeNoCommit(
  projectPath: string,
  source: string,
): Promise<{ success: boolean; hasConflicts?: boolean; conflictedFiles?: string[]; error?: string }> {
  const { exec } = await import('dugite');

  // Merge is a local operation — no token auth needed
  const result = await exec(['merge', '--no-commit', '--no-ff', source], projectPath);

  if (result.exitCode === 0) {
    return { success: true, hasConflicts: false };
  }

  // Check if it's a conflict (exit code 1 with unmerged paths)
  const stderr = result.stderr || '';
  const stdout = result.stdout || '';
  if (stderr.includes('CONFLICT') || stdout.includes('CONFLICT') || stderr.includes('Automatic merge failed')) {
    // Get list of conflicted files
    const diffResult = await exec(['diff', '--name-only', '--diff-filter=U'], projectPath);
    const conflictedFiles = diffResult.stdout.trim().split('\n').filter(Boolean);
    return { success: true, hasConflicts: true, conflictedFiles };
  }

  return { success: false, error: stderr || 'Merge failed' };
}

export async function gitStageAndCommitMerge(
  projectPath: string,
  files: string[],
  message: string,
): Promise<GitResult> {
  const { exec } = await import('dugite');

  // Stage specified files
  for (const file of files) {
    const addResult = await exec(['add', file], projectPath);
    if (addResult.exitCode !== 0) {
      return { success: false, error: addResult.stderr || `Failed to stage ${file}` };
    }
  }

  // Also stage any auto-merged files that git resolved
  await exec(['add', '-u'], projectPath);

  const commitResult = await exec(['commit', '-m', message], projectPath);
  if (commitResult.exitCode !== 0) {
    return { success: false, error: commitResult.stderr || 'Commit failed' };
  }
  return { success: true };
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

  return withTokenAuth(projectPath, token, async () => {
    const fetchRes = await exec(['fetch', '--prune', 'origin'], projectPath);
    if (fetchRes.exitCode !== 0) {
      return { success: false, error: fetchRes.stderr || 'Fetch failed' };
    }

    const ancestorRes = await exec(
      ['merge-base', '--is-ancestor', 'main', 'origin/main'],
      projectPath,
    );
    if (ancestorRes.exitCode !== 0) {
      // Exit code 1 means "not an ancestor" → local main has diverged.
      return { success: false, error: 'DIVERGED' };
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
  });
}

/**
 * Clone a repository. Embeds token in URL during clone, then resets to clean URL.
 */
export async function gitClone(
  cloneUrl: string,
  targetPath: string,
  token: string | null,
): Promise<GitResult> {
  const { exec } = await import('dugite');
  const path = await import('path');

  const parentDir = path.dirname(targetPath);

  // Build URL with token if available
  const url = token
    ? cloneUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`)
    : cloneUrl;

  const result = await exec(['clone', url, targetPath], parentDir);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Clone failed' };
  }

  // Reset remote URL to clean (no token)
  if (token) {
    await exec(['remote', 'set-url', 'origin', cloneUrl], targetPath);
  }

  return { success: true };
}
