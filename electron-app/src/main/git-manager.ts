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

export async function gitCheckout(
  projectPath: string,
  branchName: string,
): Promise<GitResult> {
  const { exec } = await import('dugite');

  // Check for local branch first, then try remote tracking
  const localCheck = await exec(['rev-parse', '--verify', branchName], projectPath);
  if (localCheck.exitCode !== 0) {
    // Try to create local tracking branch from remote
    const trackResult = await exec(
      ['checkout', '-b', branchName, `origin/${branchName}`],
      projectPath,
    );
    if (trackResult.exitCode !== 0) {
      return { success: false, error: trackResult.stderr || `Branch ${branchName} not found` };
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

export async function gitHasMergeConflict(
  projectPath: string,
): Promise<boolean> {
  const { exec } = await import('dugite');
  const result = await exec(['rev-parse', '--verify', 'MERGE_HEAD'], projectPath);
  return result.exitCode === 0;
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
