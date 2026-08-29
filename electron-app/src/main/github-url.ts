/**
 * Remote-URL parsing, shared by both GitHub clients (WP-08 §2).
 *
 * This used to be duplicated: `github-manager.parseOwnerRepo` for production
 * and a private copy inside `FakeGitHubClient` that additionally accepted
 * local file paths. The copies could — and did — drift. There is now one
 * parser for real remotes, plus one explicit, named extension for the fake's
 * local bare repositories.
 */

/**
 * Parse `owner`/`repo` out of a GitHub HTTPS or SSH remote URL.
 *
 * Returns `null` for anything that is not a github.com remote — including
 * local paths. That is deliberate: production remotes are always github.com,
 * and silently accepting a filesystem path here would let a test-only
 * affordance leak into shipped behaviour.
 */
export function parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
  // HTTPS: https://github.com/owner/repo.git — SSH: git@github.com:owner/repo.git
  const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

/**
 * Test-only extension of {@link parseOwnerRepo}.
 *
 * `FakeGitHubClient` stands in for GitHub at the protocol level, so its
 * "remotes" are local bare repositories at
 * `<bareRemoteDir>/<owner>/<repo>.git`. Those still have to resolve to an
 * owner/repo pair for the collaborator and invitation surfaces to work in
 * e2e. Real remotes are parsed by the shared parser first; only an absolute
 * path falls through to the local form.
 */
export function parseFakeRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const real = parseOwnerRepo(remoteUrl);
  if (real) return real;

  if (remoteUrl.startsWith('/')) {
    const match = remoteUrl.match(/\/([^/]+)\/([^/]+?)\.git$/);
    if (match) return { owner: match[1], repo: match[2] };
  }
  return null;
}
