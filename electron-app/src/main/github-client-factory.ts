import type { GitHubClient } from './github-client';
import { RealGitHubClient } from './real-github-client';
import { FakeGitHubClient } from './fake-github-client';
import { FakeGitHubRegistry } from './fake-github-registry';

let instance: GitHubClient | null = null;

export function getGitHubClient(): GitHubClient {
  if (instance) return instance;

  const registryPath = process.env.COLREV_FAKE_GITHUB_REGISTRY;
  if (registryPath) {
    const registry = new FakeGitHubRegistry(registryPath);
    instance = new FakeGitHubClient(registry);
  } else {
    instance = new RealGitHubClient();
  }

  return instance;
}

export function resetGitHubClient(): void {
  instance = null;
}
