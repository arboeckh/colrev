import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useProjectsStore } from './projects';
import { useNotificationsStore } from './notifications';
import type { GitHubRepo } from '@/types/window';

export const useGithubReposStore = defineStore('github-repos', () => {
  const projects = useProjectsStore();
  const notifications = useNotificationsStore();

  const remoteRepos = ref<GitHubRepo[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const cloningRepos = ref<string[]>([]);
  let lastFetchedAt = 0;

  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  /** Remote repos not already cloned locally (matched by repo name to project id). */
  const availableRepos = computed(() => {
    const localIds = new Set(projects.projects.map((p) => p.id));
    return remoteRepos.value.filter((r) => !localIds.has(r.name));
  });

  async function fetchRepos(force = false) {
    if (!force && Date.now() - lastFetchedAt < CACHE_DURATION && remoteRepos.value.length > 0) {
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      const result = await window.github.listColrevRepos();
      if (result.success) {
        remoteRepos.value = result.repos;
        lastFetchedAt = Date.now();
      } else {
        error.value = result.error || 'Failed to fetch repos';
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch repos';
    } finally {
      isLoading.value = false;
    }
  }

  async function cloneRepo(repo: GitHubRepo) {
    if (cloningRepos.value.includes(repo.fullName)) return;

    cloningRepos.value.push(repo.fullName);

    try {
      const result = await window.github.cloneRepo({
        cloneUrl: repo.cloneUrl,
        projectId: repo.name,
      });

      if (result.success) {
        // Add to local projects store
        projects.addProject(repo.name, undefined, repo.name);
        notifications.success('Project cloned', `${repo.name} is now available locally`);
      } else {
        notifications.error('Clone failed', result.error || 'Unknown error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      notifications.error('Clone failed', msg);
    } finally {
      cloningRepos.value = cloningRepos.value.filter((r) => r !== repo.fullName);
    }
  }

  function isCloning(fullName: string) {
    return cloningRepos.value.includes(fullName);
  }

  return {
    remoteRepos,
    isLoading,
    error,
    cloningRepos,
    availableRepos,
    fetchRepos,
    cloneRepo,
    isCloning,
  };
});
