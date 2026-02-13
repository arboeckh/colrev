/**
 * GitHub repository management using the GitHub API and dugite for git operations.
 * Handles creating repos, pushing local projects, listing CoLRev repos, and cloning.
 */

export interface GitHubRepo {
  name: string;
  fullName: string;
  owner: string;
  htmlUrl: string;
  description: string | null;
  isPrivate: boolean;
  updatedAt: string;
  cloneUrl: string;
}

/**
 * Fetch all repos the authenticated user owns or collaborates on (paginated).
 */
export async function listUserRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=${perPage}&sort=updated&affiliation=owner,collaborator&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    );

    if (!res.ok) break;

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    for (const r of data) {
      repos.push({
        name: r.name,
        fullName: r.full_name,
        owner: r.owner?.login ?? '',
        htmlUrl: r.html_url,
        description: r.description,
        isPrivate: r.private,
        updatedAt: r.updated_at,
        cloneUrl: r.clone_url,
      });
    }

    if (data.length < perPage) break;
    page++;
  }

  return repos;
}

/**
 * Check if a GitHub repo contains a settings.json (CoLRev indicator) at its root.
 */
export async function checkIsColrevRepo(
  token: string,
  owner: string,
  repo: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/settings.json`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    );
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * List all CoLRev repos for the authenticated user.
 * Checks repos in parallel (chunked, 10 concurrent).
 */
export async function listColrevRepos(token: string): Promise<GitHubRepo[]> {
  const allRepos = await listUserRepos(token);
  const colrevRepos: GitHubRepo[] = [];
  const chunkSize = 10;

  for (let i = 0; i < allRepos.length; i += chunkSize) {
    const chunk = allRepos.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (repo) => {
        const isColrev = await checkIsColrevRepo(token, repo.owner, repo.name);
        return { repo, isColrev };
      }),
    );
    for (const { repo, isColrev } of results) {
      if (isColrev) colrevRepos.push(repo);
    }
  }

  return colrevRepos;
}

export interface GitHubRelease {
  id: number;
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  draft: boolean;
  prerelease: boolean;
  createdAt: string;
  publishedAt: string | null;
  author: string;
}

/**
 * Parse owner/repo from a GitHub HTTPS or SSH URL.
 */
export function parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  return null;
}

/**
 * List releases for a GitHub repository.
 */
export async function listReleases(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubRelease[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );

  if (!res.ok) return [];

  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data.map((r: any) => ({
    id: r.id,
    tagName: r.tag_name,
    name: r.name || r.tag_name,
    body: r.body || '',
    htmlUrl: r.html_url,
    draft: r.draft,
    prerelease: r.prerelease,
    createdAt: r.created_at,
    publishedAt: r.published_at,
    author: r.author?.login || '',
  }));
}

/**
 * Create a GitHub release.
 */
export async function createGitHubRelease(
  token: string,
  owner: string,
  repo: string,
  params: { tagName: string; name: string; body: string },
): Promise<{ success: boolean; release?: GitHubRelease; error?: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tag_name: params.tagName,
        name: params.name,
        body: params.body,
      }),
    },
  );

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    return { success: false, error: errorData.message || 'Failed to create release' };
  }

  const r = await res.json();
  return {
    success: true,
    release: {
      id: r.id,
      tagName: r.tag_name,
      name: r.name || r.tag_name,
      body: r.body || '',
      htmlUrl: r.html_url,
      draft: r.draft,
      prerelease: r.prerelease,
      createdAt: r.created_at,
      publishedAt: r.published_at,
      author: r.author?.login || '',
    },
  };
}

interface CreateRepoAndPushParams {
  token: string;
  repoName: string;
  projectPath: string;
  isPrivate: boolean;
  description?: string;
}

interface CreateRepoAndPushResult {
  success: boolean;
  repoUrl?: string;
  htmlUrl?: string;
  error?: string;
}

export async function createRepoAndPush(
  params: CreateRepoAndPushParams,
): Promise<CreateRepoAndPushResult> {
  const { token, repoName, projectPath, isPrivate, description } = params;
  const { exec } = await import('dugite');

  try {
    // 1. Get the authenticated user's login
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!userRes.ok) {
      return { success: false, error: 'Failed to fetch GitHub user. Token may be expired.' };
    }

    const userData = await userRes.json();
    const login: string = userData.login;

    // 2. Create the repository on GitHub
    const createRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: repoName,
        private: isPrivate,
        description: description || '',
        auto_init: false,
      }),
    });

    if (!createRes.ok) {
      const errorData = await createRes.json();
      const msg =
        errorData.errors?.[0]?.message || errorData.message || 'Failed to create repository';
      return { success: false, error: msg };
    }

    const repoData = await createRes.json();
    const htmlUrl: string = repoData.html_url;
    const cleanUrl = `https://github.com/${login}/${repoName}.git`;
    const tokenUrl = `https://x-access-token:${token}@github.com/${login}/${repoName}.git`;

    // 3. Check existing remotes
    const remoteResult = await exec(['remote'], projectPath);
    const remotes = remoteResult.stdout
      .trim()
      .split('\n')
      .filter((r) => r.length > 0);
    const hasOrigin = remotes.includes('origin');

    // 4. Set origin to token-embedded URL
    if (hasOrigin) {
      await exec(['remote', 'set-url', 'origin', tokenUrl], projectPath);
    } else {
      await exec(['remote', 'add', 'origin', tokenUrl], projectPath);
    }

    // 5. Push — try 'main' first, fallback to 'master'
    let pushResult = await exec(['push', '-u', 'origin', 'main'], projectPath);
    if (pushResult.exitCode !== 0) {
      // Try master branch
      pushResult = await exec(['push', '-u', 'origin', 'master'], projectPath);
      if (pushResult.exitCode !== 0) {
        // Reset URL to clean before returning error
        await exec(['remote', 'set-url', 'origin', cleanUrl], projectPath);
        return {
          success: false,
          error: `Git push failed: ${pushResult.stderr || pushResult.stdout}`,
        };
      }
    }

    // 6. Reset remote URL to clean (no token)
    await exec(['remote', 'set-url', 'origin', cleanUrl], projectPath);

    return { success: true, repoUrl: cleanUrl, htmlUrl };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error creating repository',
    };
  }
}
