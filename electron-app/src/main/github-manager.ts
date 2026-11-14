/**
 * GitHub repository management using the GitHub API and dugite for git operations.
 * Handles creating repos, pushing local projects, listing CoLRev repos, and cloning.
 */
import { parseOwnerRepo } from './github-url';

/** An HTTP failure from the GitHub API. Thrown by list calls so that an
 * expired token or a rate limit is not mistaken for "no results". */
export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

interface ResponseLike {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<any>;
}

function isRateLimited(res: ResponseLike): boolean {
  if (res.status === 429) return true;
  return res.status === 403 && res.headers?.get('x-ratelimit-remaining') === '0';
}

/** Turn a non-OK response into a GitHubApiError with a message a person can act on. */
async function apiError(res: ResponseLike, what: string): Promise<GitHubApiError> {
  if (res.status === 401) {
    return new GitHubApiError(
      401,
      `GitHub rejected the sign-in while ${what}. Sign in again and retry.`,
    );
  }
  if (isRateLimited(res)) {
    return new GitHubApiError(
      res.status,
      `GitHub rate limit reached while ${what}. Wait a few minutes and retry.`,
    );
  }
  const body = await res.json().catch(() => ({}));
  const detail = body?.message ? `: ${body.message}` : '';
  return new GitHubApiError(res.status, `GitHub returned HTTP ${res.status} while ${what}${detail}`);
}

async function ensureOk(res: ResponseLike, what: string): Promise<void> {
  if (!res.ok) throw await apiError(res, what);
}

// --- Session caches ---------------------------------------------------------
// Listing repos is 1 + N requests; the suggestion box asks for it again on
// every focus. Successful results are kept for a short time per token, and
// concurrent identical requests share one in-flight promise.

const CACHE_TTL_MS = 60_000;

class TtlCache<T> {
  private entries = new Map<string, { at: number; value: Promise<T> }>();

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = load();
    this.entries.set(key, { at: Date.now(), value });
    // Failures are never cached.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

const userReposCache = new TtlCache<GitHubRepo[]>();
const colrevReposCache = new TtlCache<GitHubRepo[]>();
const suggestionCandidatesCache = new TtlCache<GitHubCollaborator[]>();

/** Drop every cached list (after a change made through this app, and in tests). */
export function clearGitHubCaches(): void {
  userReposCache.clear();
  colrevReposCache.clear();
  suggestionCandidatesCache.clear();
}

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

export interface GitHubCollaborator {
  login: string;
  name: string | null;
  avatarUrl: string;
}

/**
 * Fetch all repos the authenticated user owns or collaborates on (paginated).
 */
export function listUserRepos(token: string): Promise<GitHubRepo[]> {
  return userReposCache.get(token, () => fetchUserRepos(token));
}

async function fetchUserRepos(token: string): Promise<GitHubRepo[]> {
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

    await ensureOk(res, 'listing your repositories');

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
    if (res.status === 200) return true;
    // 404: no settings.json; 409: empty repository; 451/other 403: repo blocked
    // or not readable. None of those make it a CoLRev repo, and none of them
    // say anything about the account's access as a whole. A bad token or a
    // rate limit does, so those surface.
    if (res.status === 401 || isRateLimited(res)) {
      throw await apiError(res, `checking ${owner}/${repo}`);
    }
    return false;
  } catch (err) {
    if (err instanceof GitHubApiError) throw err;
    return false;
  }
}

/**
 * List all CoLRev repos for the authenticated user.
 * Checks repos in parallel (chunked, 10 concurrent).
 */
export function listColrevRepos(token: string): Promise<GitHubRepo[]> {
  return colrevReposCache.get(token, () => fetchColrevRepos(token));
}

async function fetchColrevRepos(token: string): Promise<GitHubRepo[]> {
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

// The one remote-URL parser (WP-08 §2). Re-exported here so existing
// importers of `github-manager` keep working; the implementation lives in
// `github-url.ts` so both clients — and the contract suite — share it.
export { parseOwnerRepo };

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

  await ensureOk(res, `listing releases of ${owner}/${repo}`);

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

export async function listRepoCollaborators(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubCollaborator[]> {
  const collaborators: GitHubCollaborator[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/collaborators?per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    );

    await ensureOk(res, `listing collaborators of ${owner}/${repo}`);

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    collaborators.push(
      ...data.map((collaborator: any) => ({
        login: collaborator.login,
        name: collaborator.name ?? null,
        avatarUrl: collaborator.avatar_url ?? '',
      })),
    );

    if (data.length < perPage) break;
    page += 1;
  }

  return collaborators;
}

/**
 * Invite a collaborator to a GitHub repository.
 * Uses the PUT /repos/{owner}/{repo}/collaborators/{username} endpoint.
 */
const SEARCH_MIN_QUERY_LENGTH = 2;
const SUGGESTED_REPO_LIMIT = 15;
const SUGGESTED_USER_LIMIT = 15;

async function listOrgMembers(token: string, org: string): Promise<GitHubCollaborator[]> {
  const members: GitHubCollaborator[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const res = await fetch(
      `https://api.github.com/orgs/${org}/members?per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    );

    await ensureOk(res, `listing members of ${org}`);

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    members.push(
      ...data.map((member: { login: string; avatar_url?: string }) => ({
        login: member.login,
        name: null,
        avatarUrl: member.avatar_url ?? '',
      })),
    );

    if (data.length < perPage || members.length >= SUGGESTED_USER_LIMIT) break;
    page += 1;
  }

  return members.slice(0, SUGGESTED_USER_LIMIT);
}

/**
 * Search GitHub users by login prefix via the Search API.
 */
export async function searchGitHubUsers(
  token: string,
  query: string,
  limit = 8,
): Promise<GitHubCollaborator[]> {
  const trimmed = query.trim();
  if (trimmed.length < SEARCH_MIN_QUERY_LENGTH) return [];

  const encoded = encodeURIComponent(`${trimmed} in:login type:user`);
  const res = await fetch(
    `https://api.github.com/search/users?q=${encoded}&per_page=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );

  await ensureOk(res, 'searching GitHub users');

  const data = await res.json();
  if (!Array.isArray(data.items)) return [];

  return data.items.map((user: { login: string; avatar_url?: string }) => ({
    login: user.login,
    name: null,
    avatarUrl: user.avatar_url ?? '',
  }));
}

/**
 * Suggest collaborators from org membership and other repositories the user can access.
 *
 * The candidate list costs up to 1 + 3 + 15 requests, so it is gathered once per
 * token and repository and kept for a minute; `excludeLogins` is applied to the
 * cached list, so it can change between calls.
 */
export async function listSuggestedCollaborators(
  token: string,
  owner: string,
  repo: string,
  excludeLogins: string[],
): Promise<GitHubCollaborator[]> {
  const exclude = new Set(excludeLogins.map((login) => login.toLowerCase()));
  const candidates = await suggestionCandidatesCache.get(`${token}\n${owner}/${repo}`, () =>
    gatherSuggestionCandidates(token, owner, repo),
  );
  return candidates
    .filter((c) => !exclude.has(c.login.toLowerCase()))
    .slice(0, SUGGESTED_USER_LIMIT);
}

async function gatherSuggestionCandidates(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubCollaborator[]> {
  const currentFullName = `${owner}/${repo}`;
  const suggestions = new Map<string, GitHubCollaborator>();

  const addSuggestion = (collaborator: GitHubCollaborator) => {
    const key = collaborator.login.toLowerCase();
    if (suggestions.has(key)) return;
    suggestions.set(key, collaborator);
  };

  try {
    const ownerRes = await fetch(`https://api.github.com/users/${owner}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (ownerRes.ok) {
      const ownerData = await ownerRes.json();
      if (ownerData.type === 'Organization') {
        for (const member of await listOrgMembers(token, owner)) {
          addSuggestion(member);
        }
      }
    }
  } catch {
    // Ignore org lookup failures and fall back to repo-based suggestions.
  }

  // Failing to list the account's repos (expired token, rate limit) is an
  // error the caller should see, not an empty suggestion box.
  const repos = await listUserRepos(token);
  const otherRepos = repos
    .filter((entry) => entry.fullName !== currentFullName)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, SUGGESTED_REPO_LIMIT);

  const chunkSize = 5;
  for (let i = 0; i < otherRepos.length; i += chunkSize) {
    const chunk = otherRepos.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map((entry) =>
        // Listing collaborators needs push access; repos the user can only read
        // answer 403, which just means "no suggestions from this one".
        listRepoCollaborators(token, entry.owner, entry.name).catch(() => []),
      ),
    );
    for (const collaborators of results) {
      for (const collaborator of collaborators) {
        addSuggestion(collaborator);
      }
    }
    if (suggestions.size >= SUGGESTED_USER_LIMIT * 2) break;
  }

  return Array.from(suggestions.values());
}

/**
 * Return invite suggestions: contextual picks when the query is short, Search API otherwise.
 */
export async function getInviteUserSuggestions(
  token: string,
  remoteUrl: string,
  query: string,
  excludeLogins: string[],
): Promise<GitHubCollaborator[]> {
  const parsed = parseOwnerRepo(remoteUrl);
  if (!parsed) return [];

  const trimmed = query.trim();
  if (trimmed.length >= SEARCH_MIN_QUERY_LENGTH) {
    const exclude = new Set(excludeLogins.map((login) => login.toLowerCase()));
    const results = await searchGitHubUsers(token, trimmed);
    return results.filter((user) => !exclude.has(user.login.toLowerCase()));
  }

  return listSuggestedCollaborators(token, parsed.owner, parsed.repo, excludeLogins);
}

export async function addRepoCollaborator(
  token: string,
  owner: string,
  repo: string,
  username: string,
  permission: 'pull' | 'push' | 'admin' = 'push',
): Promise<{ success: boolean; invited: boolean; error?: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/collaborators/${username}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ permission }),
    },
  );

  if (res.status === 201) {
    // Invitation created
    return { success: true, invited: true };
  }
  if (res.status === 204) {
    // User already a collaborator (no invitation needed)
    return { success: true, invited: false };
  }

  const errorData = await res.json().catch(() => ({}));
  return {
    success: false,
    invited: false,
    error: errorData.message || `Failed to add collaborator (${res.status})`,
  };
}

export interface PendingRepoInvitation {
  id: number;
  inviteeLogin: string;
  inviteeAvatarUrl: string;
  permission: string;
  createdAt: string;
}

/**
 * List pending invitations for a repository (owner/admin perspective).
 */
export async function listPendingRepoInvitations(
  token: string,
  owner: string,
  repo: string,
): Promise<PendingRepoInvitation[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/invitations?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );

  await ensureOk(res, `listing pending invitations of ${owner}/${repo}`);

  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data.map((inv: any) => ({
    id: inv.id,
    inviteeLogin: inv.invitee?.login ?? '',
    inviteeAvatarUrl: inv.invitee?.avatar_url ?? '',
    permission: inv.permissions ?? '',
    createdAt: inv.created_at ?? '',
  }));
}

export interface RepoInvitation {
  id: number;
  repoFullName: string;
  repoUrl: string;
  inviter: string;
  inviterAvatarUrl: string;
  permission: string;
  createdAt: string;
}

/**
 * List pending repository invitations for the authenticated user.
 */
export async function listRepoInvitations(token: string): Promise<RepoInvitation[]> {
  const res = await fetch('https://api.github.com/user/repository_invitations?per_page=100', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  await ensureOk(res, 'listing your repository invitations');

  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data.map((inv: any) => ({
    id: inv.id,
    repoFullName: inv.repository?.full_name ?? '',
    repoUrl: inv.repository?.html_url ?? '',
    inviter: inv.inviter?.login ?? '',
    inviterAvatarUrl: inv.inviter?.avatar_url ?? '',
    permission: inv.permissions ?? '',
    createdAt: inv.created_at ?? '',
  }));
}

/**
 * Accept a repository invitation.
 */
export async function acceptRepoInvitation(
  token: string,
  invitationId: number,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(
    `https://api.github.com/user/repository_invitations/${invitationId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );

  if (res.status === 204 || res.status === 200) {
    return { success: true };
  }

  const errorData = await res.json().catch(() => ({}));
  return {
    success: false,
    error: errorData.message || `Failed to accept invitation (${res.status})`,
  };
}

/**
 * Decline a repository invitation.
 */
export async function declineRepoInvitation(
  token: string,
  invitationId: number,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(
    `https://api.github.com/user/repository_invitations/${invitationId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );

  if (res.status === 204 || res.status === 200) {
    return { success: true };
  }

  const errorData = await res.json().catch(() => ({}));
  return {
    success: false,
    error: errorData.message || `Failed to decline invitation (${res.status})`,
  };
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

/**
 * The name GitHub will give a repository created from `name`: runs of
 * characters outside letters, digits, `.`, `-` and `_` become a hyphen
 * ("My Review" becomes "My-Review"). Used to look a repository up again on a
 * retry; the URL of a new repository always comes from GitHub's answer.
 */
export function normalizeRepoName(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, '-');
}

type ExecFn = (args: string[], cwd: string) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

/**
 * Work out which branch to push, recovering a dangling HEAD. Local checks
 * only: this runs before anything is created on GitHub, so that a project
 * that cannot be pushed does not leave an empty repository behind.
 */
async function resolvePushBranch(
  exec: ExecFn,
  projectPath: string,
): Promise<{ branch: string } | { error: string }> {
  const branchRes = await exec(['symbolic-ref', '--short', 'HEAD'], projectPath);
  if (branchRes.exitCode !== 0) {
    return {
      error:
        'Cannot push: the repository has no commits yet. ' +
        'Initialize the project fully before publishing to GitHub.',
    };
  }
  let branch = branchRes.stdout.trim();

  // Defensive: if HEAD points at a ref that doesn't exist (dangling — can
  // happen when an upstream rename updated the ref but not HEAD), recover
  // before pushing. Try `main`; otherwise pick any branch with commits.
  const refCheck = await exec(['rev-parse', '--verify', `refs/heads/${branch}`], projectPath);
  if (refCheck.exitCode !== 0) {
    const branchesRes = await exec(
      ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'],
      projectPath,
    );
    const localBranches = branchesRes.stdout
      .trim()
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
    const recoverTo = localBranches.find((b) => b === 'main') ?? localBranches[0];
    if (!recoverTo) {
      return { error: 'Cannot push: HEAD is dangling and no local branches have commits.' };
    }
    const fix = await exec(['symbolic-ref', 'HEAD', `refs/heads/${recoverTo}`], projectPath);
    if (fix.exitCode !== 0) {
      return { error: `Cannot push: could not repair HEAD: ${fix.stderr || fix.stdout}` };
    }
    branch = recoverTo;
  }
  return { branch };
}

/** A repository that already exists on the account and has no branches yet. */
async function findReusableEmptyRepo(
  token: string,
  login: string,
  name: string,
): Promise<{ data: any } | { reason: string }> {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const repoRes = await fetch(`https://api.github.com/repos/${login}/${name}`, { headers });
  if (!repoRes.ok) {
    return { reason: `GitHub returned HTTP ${repoRes.status} when looking up ${login}/${name}` };
  }
  const data = await repoRes.json();
  if (String(data.owner?.login ?? '').toLowerCase() !== login.toLowerCase()) {
    return { reason: `${login}/${name} is not owned by this account` };
  }
  const branchesRes = await fetch(
    `https://api.github.com/repos/${login}/${name}/branches?per_page=1`,
    { headers },
  );
  if (!branchesRes.ok) {
    return { reason: `could not check whether ${login}/${name} is empty (HTTP ${branchesRes.status})` };
  }
  const branches = await branchesRes.json();
  if (!Array.isArray(branches) || branches.length > 0) {
    return { reason: `${login}/${name} already has commits` };
  }
  return { data };
}

export async function createRepoAndPush(
  params: CreateRepoAndPushParams,
): Promise<CreateRepoAndPushResult> {
  const { token, repoName, projectPath, isPrivate, description } = params;
  const { exec } = (await import('dugite')) as { exec: ExecFn };

  // What is on GitHub once the repository exists; used to say where things
  // stand if a later step fails.
  let created: { fullName: string; htmlUrl: string } | null = null;
  // The project's `origin` as it was before this call, restored on failure.
  let originBefore: { url: string | null } | null = null;
  let originChanged = false;

  const restoreOrigin = async (): Promise<string> => {
    if (!originChanged || !originBefore) return "The project's 'origin' remote was not changed.";
    const res = originBefore.url
      ? await exec(['remote', 'set-url', 'origin', originBefore.url], projectPath)
      : await exec(['remote', 'remove', 'origin'], projectPath);
    originChanged = res.exitCode !== 0;
    if (res.exitCode !== 0) {
      return `The project's 'origin' remote could not be restored (${res.stderr || res.stdout}); check it with "git remote -v".`;
    }
    return originBefore.url
      ? `The project's 'origin' remote was restored to ${originBefore.url}.`
      : "The project's 'origin' remote was removed again.";
  };

  const fail = async (message: string): Promise<CreateRepoAndPushResult> => {
    if (!created) return { success: false, error: message };
    const originNote = await restoreOrigin();
    return {
      success: false,
      error:
        `${message}\n\nThe repository ${created.fullName} was created on GitHub (${created.htmlUrl}) ` +
        `but nothing was pushed to it. ${originNote} ` +
        `Publish again with the same name to reuse the empty repository.`,
    };
  };

  try {
    // 0. Local preflight, before anything exists on GitHub.
    const resolved = await resolvePushBranch(exec, projectPath);
    if ('error' in resolved) return { success: false, error: resolved.error };
    const { branch } = resolved;

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

    // 2. Create the repository on GitHub — or, on a retry, reuse the empty one
    // an earlier attempt left behind.
    const name = normalizeRepoName(repoName);
    if (!name || name === '.' || name === '..') {
      return { success: false, error: `"${repoName}" is not a valid repository name.` };
    }

    const createRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        private: isPrivate,
        description: description || '',
        auto_init: false,
      }),
    });

    let repoData: any;
    if (createRes.ok) {
      repoData = await createRes.json();
      clearGitHubCaches();
    } else {
      const errorData = await createRes.json().catch(() => ({}));
      const msg =
        errorData.errors?.[0]?.message || errorData.message || 'Failed to create repository';
      if (createRes.status !== 422 || !/already exists/i.test(msg)) {
        return { success: false, error: msg };
      }
      const existing = await findReusableEmptyRepo(token, login, name);
      if ('reason' in existing) {
        return {
          success: false,
          error: `A repository named "${name}" already exists on this account and cannot be reused (${existing.reason}). Choose another name.`,
        };
      }
      repoData = existing.data;
    }

    // From here on, the names and URLs are the ones GitHub reports: it may
    // have normalised what the user typed.
    const repoOwner: string = repoData.owner?.login ?? login;
    const actualName: string = repoData.name;
    const htmlUrl: string = repoData.html_url;
    const cleanUrl: string = repoData.clone_url;
    created = { fullName: `${repoOwner}/${actualName}`, htmlUrl };

    // 2b. Disable GitHub Actions before the first push. CoLRev projects ship
    // workflow files that would otherwise run CI on every sync. Best-effort:
    // a failure here must not block publishing.
    try {
      const actionsRes = await fetch(
        `https://api.github.com/repos/${repoOwner}/${actualName}/actions/permissions`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ enabled: false }),
        },
      );
      if (!actionsRes.ok) {
        console.warn(
          `[github] could not disable Actions on ${repoOwner}/${actualName}: HTTP ${actionsRes.status}`,
        );
      }
    } catch (err) {
      console.warn(`[github] could not disable Actions on ${repoOwner}/${actualName}:`, err);
    }
    const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
    const authArgs = ['-c', `http.extraheader=Authorization: Basic ${auth}`];

    // 3. Set origin to the clean URL — token never lands in .git/config.
    const currentOrigin = await exec(['remote', 'get-url', 'origin'], projectPath);
    const hadOrigin = currentOrigin.exitCode === 0;
    originBefore = { url: hadOrigin ? currentOrigin.stdout.trim() : null };
    const remoteResult = await exec(
      ['remote', hadOrigin ? 'set-url' : 'add', 'origin', cleanUrl],
      projectPath,
    );
    if (remoteResult.exitCode !== 0) {
      return fail(
        `Could not set the project's 'origin' remote to ${cleanUrl}: ${remoteResult.stderr || remoteResult.stdout}`,
      );
    }
    originChanged = true;

    // 4. Push the current branch — whatever it's named locally.
    // --no-verify skips git hooks. CoLRev's init installs pre-commit pre-push
    // hooks that hard-code sys.executable, which in the packaged app is the
    // PyInstaller bundle (`colrev-jsonrpc`) — not a real Python — so the hook
    // crashes with "unrecognized arguments: -mpre_commit ...". The UI publish
    // flow isn't a developer workflow gate; skip the hook entirely.
    const pushResult = await exec(
      [...authArgs, 'push', '--no-verify', '-u', 'origin', branch],
      projectPath,
    );
    if (pushResult.exitCode !== 0) {
      return fail(`Git push failed (branch ${branch}): ${pushResult.stderr || pushResult.stdout}`);
    }

    return { success: true, repoUrl: cleanUrl, htmlUrl };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Unknown error creating repository');
  }
}
