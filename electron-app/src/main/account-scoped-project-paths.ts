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
