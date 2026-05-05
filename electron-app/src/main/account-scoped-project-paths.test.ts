import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { AccountScopedProjectPaths } from './account-scoped-project-paths';

describe('AccountScopedProjectPaths', () => {
  const userData = '/mock/userData';

  describe('projectsRootForAccount', () => {
    it('returns userData/projects/<login> for a given account', () => {
      const paths = new AccountScopedProjectPaths(userData);
      expect(paths.projectsRootForAccount('alice')).toBe(
        path.join(userData, 'projects', 'alice'),
      );
    });

    it('returns different roots for different accounts', () => {
      const paths = new AccountScopedProjectPaths(userData);
      const aliceRoot = paths.projectsRootForAccount('alice');
      const bobRoot = paths.projectsRootForAccount('bob');
      expect(aliceRoot).not.toBe(bobRoot);
      expect(aliceRoot).toBe(path.join(userData, 'projects', 'alice'));
      expect(bobRoot).toBe(path.join(userData, 'projects', 'bob'));
    });
  });

  describe('projectPath', () => {
    it('returns userData/projects/<login>/<projectId>', () => {
      const paths = new AccountScopedProjectPaths(userData);
      expect(paths.projectPath('alice', 'my-review')).toBe(
        path.join(userData, 'projects', 'alice', 'my-review'),
      );
    });

    it('isolates projects between accounts', () => {
      const paths = new AccountScopedProjectPaths(userData);
      const aliceProject = paths.projectPath('alice', 'shared-review');
      const bobProject = paths.projectPath('bob', 'shared-review');
      expect(aliceProject).not.toBe(bobProject);
    });
  });

  describe('projectsRoot', () => {
    it('returns the base projects directory', () => {
      const paths = new AccountScopedProjectPaths(userData);
      expect(paths.projectsRoot).toBe(path.join(userData, 'projects'));
    });
  });
});
