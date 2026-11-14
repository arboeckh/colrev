import * as path from 'path';

export class AccountScopedProjectPaths {
  private readonly userDataPath: string;

  constructor(userDataPath: string) {
    this.userDataPath = userDataPath;
  }

  get projectsRoot(): string {
    return path.join(this.userDataPath, 'projects');
  }

  projectsRootForAccount(login: string): string {
    return path.join(this.projectsRoot, login);
  }

  projectPath(login: string, projectId: string): string {
    return path.join(this.projectsRootForAccount(login), projectId);
  }
}

/**
 * Resolve `segments` under `root`, or null when the result is not strictly
 * inside it. Compares against the root plus a separator: a bare prefix check
 * would accept `/data/alice2/x` as being inside `/data/alice`.
 */
export function resolveInsideRoot(root: string, ...segments: string[]): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...segments);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  return resolved.startsWith(prefix) ? resolved : null;
}
