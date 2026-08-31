<script setup lang="ts">
import 'vue-sonner/style.css';
import { onMounted, watch, computed } from 'vue';
import { useRoute } from 'vue-router';
import { Toaster } from '@/components/ui/sonner';
import AppLayout from '@/components/layout/AppLayout.vue';
import DebugPanel from '@/components/common/DebugPanel.vue';
import ConflictResolutionDialog from '@/components/common/ConflictResolutionDialog.vue';
import PullBlockedDialog from '@/components/common/PullBlockedDialog.vue';
import BranchSwitchBlockedDialog from '@/components/common/BranchSwitchBlockedDialog.vue';
import ResetToRemoteDialog from '@/components/common/ResetToRemoteDialog.vue';
import KeychainExplainerDialog from '@/components/common/KeychainExplainerDialog.vue';
import { useBackendStore } from '@/stores/backend';
import { useProjectsStore } from '@/stores/projects';
import { useAuthStore } from '@/stores/auth';
import { useGithubReposStore } from '@/stores/github-repos';

const route = useRoute();
const backend = useBackendStore();
const projects = useProjectsStore();
const auth = useAuthStore();
const githubRepos = useGithubReposStore();

// Determine which layout to use based on route meta
const useProjectLayout = computed(() => {
  return route.meta.layout === 'project' || route.matched.some((r) => r.meta.layout === 'project');
});

// The login the account-scoped state (backend.basePath, the project list,
// clone paths) was built against. `undefined` until startup binds it.
let boundLogin: string | null | undefined = undefined;

// Auto-start backend and discover projects on mount
onMounted(async () => {
  // Initialize auth first (checks for stored session)
  await auth.initialize();
  boundLogin = auth.user?.login ?? null;

  if (backend.canStart) {
    const started = await backend.start();
    if (started) {
      // Discover projects immediately after backend starts
      await discoverProjects();
      // Fetch GitHub CoLRev repos in the background if authenticated
      if (auth.isAuthenticated) {
        githubRepos.fetchRepos();
      }
    }
  }
});

// Discover existing projects from disk
async function discoverProjects() {
  try {
    const response = await backend.call('list_projects', {});
    if (response.success && response.projects) {
      for (const proj of response.projects) {
        projects.addProject(proj.id, proj.path, proj.title);
      }
    }
    // Projects are now displayed immediately
    // Status/git status will be loaded on-demand when viewing individual projects
  } catch (err) {
    console.error('Failed to discover projects:', err);
  }
}

// Fetch GitHub repos when user logs in mid-session
watch(
  () => auth.isAuthenticated,
  (isAuth) => {
    if (isAuth && backend.isRunning) {
      githubRepos.fetchRepos();
    }
  },
);

// Account identity is baked into state captured at startup: backend.basePath
// (the per-account projects root), the discovered project list, and every
// clone path derived from them. Logging in as a different account mid-session
// (sign out → device-flow login) must rebind all of it, same as the
// switch-account menu already does: land on home, then reload.
watch(
  () => auth.user?.login ?? null,
  (login) => {
    if (boundLogin === undefined) return; // startup restore, not a change
    if (login === boundLogin) return;
    if (login === null) {
      // Logged out — nothing account-scoped is shown on the login page.
      // boundLogin deliberately keeps the old value: logging back into the
      // SAME account needs no rebind, a different one reloads below.
      return;
    }
    boundLogin = login;
    window.location.hash = '#/';
    window.location.reload();
  },
);

// Watch for backend errors
watch(
  () => backend.error,
  (error) => {
    if (error) {
      console.error('Backend error:', error);
    }
  }
);
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- Toast notifications -->
    <Toaster position="bottom-right" :expand="true" />

    <!-- Debug panel (floating button in bottom right) -->
    <DebugPanel />

    <!-- Conflict resolution dialog (app-level overlay) -->
    <ConflictResolutionDialog />

    <!-- Pull blocked by local changes — recovery dialog -->
    <PullBlockedDialog />

    <!-- Dirty-tree branch switch: explicit save-or-discard, never a silent stash -->
    <BranchSwitchBlockedDialog />

    <!-- Last-resort reset-to-remote dialog -->
    <ResetToRemoteDialog />

    <!-- One-time keychain explainer (macOS) — must be mounted, otherwise
         auth.initialize() will hang on stored accounts waiting for ack. -->
    <KeychainExplainerDialog />

    <!-- Main content with conditional layout -->
    <AppLayout v-if="useProjectLayout">
      <router-view />
    </AppLayout>

    <router-view v-else />
  </div>
</template>
