/**
 * GitHub repository management using the GitHub API and dugite for git operations.
 * Handles creating repos and pushing local projects to GitHub.
 */

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
