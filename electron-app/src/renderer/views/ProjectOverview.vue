<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowRight,
  Github,
  Globe,
  Lock,
  ExternalLink,
  Loader2,
  HardDrive,
  GitBranch,
  GitMerge,
  Plus,
  ArrowUp,
  ArrowDown,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import CreateVersionDialog from '@/components/common/CreateVersionDialog.vue';
import ActivityFeed from '@/components/common/ActivityFeed.vue';
import { useProjectsStore } from '@/stores/projects';
import { useAuthStore } from '@/stores/auth';
import { useGitStore } from '@/stores/git';
import { useNotificationsStore } from '@/stores/notifications';
import { WORKFLOW_STEPS } from '@/types/project';

const router = useRouter();
const projects = useProjectsStore();
const auth = useAuthStore();
const git = useGitStore();
const notifications = useNotificationsStore();

// Version branch management
const showCreateVersionDialog = ref(false);
const isMerging = ref(false);

async function mergeIntoMain() {
  if (git.currentBranch === 'main') return;
  isMerging.value = true;
  try {
    await git.mergeIntoMain(git.currentBranch);
  } finally {
    isMerging.value = false;
  }
}

// Push to GitHub dialog state
const showPushDialog = ref(false);
const pushRepoName = ref('');
const isPushPrivate = ref(true);
const isPushing = ref(false);

// Remote status helpers
const remoteUrl = computed(() => projects.currentGitStatus?.remote_url ?? null);
const isGitHubRemote = computed(() => remoteUrl.value?.includes('github.com') ?? false);
const gitHubUrl = computed(() => {
  if (!remoteUrl.value || !isGitHubRemote.value) return null;
  return remoteUrl.value
    .replace(/\.git$/, '')
    .replace(/^git@github\.com:/, 'https://github.com/');
});

function openPushDialog() {
  pushRepoName.value = projects.currentProjectId || '';
  isPushPrivate.value = true;
  showPushDialog.value = true;
}

async function pushToGitHub() {
  if (!pushRepoName.value || !projects.currentProject) return;
  isPushing.value = true;
  try {
    const result = await window.github.createRepoAndPush({
      repoName: pushRepoName.value,
      projectPath: projects.currentProject.path,
      isPrivate: isPushPrivate.value,
    });
    if (result.success) {
      notifications.success('Pushed to GitHub', `Repository created at ${result.htmlUrl}`);
      showPushDialog.value = false;
      await projects.refreshGitStatus();
    } else {
      notifications.error('Push failed', result.error || 'Unknown error');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Push failed', msg);
  } finally {
    isPushing.value = false;
  }
}

const totalRecords = computed(() => projects.currentStatus?.total_records ?? 0);

// Next recommended step
const nextStep = computed(() => {
  const next = projects.nextOperation;
  if (!next) return null;
  return WORKFLOW_STEPS.find((s) => s.id === next) || null;
});

function navigateToStep(stepRoute: string) {
  if (projects.currentProjectId) {
    router.push(`/project/${projects.currentProjectId}/${stepRoute}`);
  }
}
</script>

<template>
  <div class="p-6 max-w-4xl">
    <!-- Header area -->
    <div class="pb-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-xl font-semibold">
            {{ projects.currentSettings?.project?.title || 'Literature Review Project' }}
          </h2>
          <p class="text-muted-foreground text-sm mt-1">
            <span v-if="totalRecords > 0">{{ totalRecords }} records</span>
            <span v-if="totalRecords > 0 && nextStep"> · </span>
            <span v-if="nextStep">Next: <span class="font-medium text-foreground">{{ nextStep.label }}</span></span>
            <span v-if="!nextStep && totalRecords === 0">No records yet — start by adding a search source.</span>
          </p>
        </div>

        <!-- Remote status -->
        <div class="flex items-center gap-2 text-sm shrink-0">
          <template v-if="isGitHubRemote && gitHubUrl">
            <a
              :href="gitHubUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              data-testid="github-repo-link"
            >
              <Github class="h-4 w-4" />
              {{ gitHubUrl.replace('https://github.com/', '') }}
              <ExternalLink class="h-3 w-3" />
            </a>
          </template>
          <template v-else-if="remoteUrl">
            <Globe class="h-4 w-4 text-muted-foreground" />
            <span class="text-muted-foreground">{{ remoteUrl }}</span>
          </template>
          <template v-else>
            <span class="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
              <HardDrive class="h-3.5 w-3.5" />
              Local only
            </span>
            <Button
              v-if="auth.isAuthenticated"
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              data-testid="push-to-github-button"
              @click="openPushDialog"
            >
              <Github class="h-3.5 w-3.5 mr-1" />
              Push to GitHub
            </Button>
          </template>
        </div>
      </div>

      <!-- Next step CTA -->
      <div v-if="nextStep" class="mt-3">
        <Button size="sm" @click="navigateToStep(nextStep.route)" class="gap-2">
          Continue to {{ nextStep.label }}
          <ArrowRight class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <Separator />

    <!-- Two-column grid: Versions + Activity -->
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-0 pt-4">
      <!-- Versions (3/5 width) -->
      <div class="lg:col-span-3 lg:pr-5 lg:border-r border-border">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-medium text-muted-foreground">Versions</h3>
          <Button
            variant="outline"
            size="sm"
            class="h-7 text-xs gap-1"
            data-testid="new-version-button"
            @click="showCreateVersionDialog = true"
          >
            <Plus class="h-3.5 w-3.5" />
            New Version
          </Button>
        </div>

        <!-- Empty state -->
        <div v-if="git.versionBranches.length === 0" class="flex flex-col items-center justify-center py-8 text-center">
          <GitBranch class="h-7 w-7 text-muted-foreground/30 mb-2" />
          <p class="text-sm text-muted-foreground">No version branches yet</p>
          <p class="text-xs text-muted-foreground/60 mt-0.5">Create one to start collaborating</p>
        </div>

        <!-- Branch list -->
        <div v-else>
          <div class="border border-border rounded-md overflow-hidden">
            <div
              v-for="(branch, index) in git.versionBranches"
              :key="branch.name"
              class="flex items-center justify-between py-2 px-3 transition-colors hover:bg-muted/40"
              :class="[
                index > 0 ? 'border-t border-border' : '',
                branch.name === git.currentBranch ? 'bg-muted/20' : '',
              ]"
              :data-testid="`version-branch-${branch.name}`"
            >
              <div class="flex items-center gap-2">
                <span
                  class="h-2 w-2 rounded-full shrink-0"
                  :class="branch.name === git.currentBranch ? 'bg-green-500' : 'bg-muted-foreground/30'"
                />
                <span class="font-mono text-sm">{{ branch.name }}</span>
                <Badge v-if="branch.name === git.currentBranch" variant="secondary" class="text-[10px] px-1.5 py-0">
                  current
                </Badge>
              </div>
              <div class="flex items-center gap-1.5">
                <Badge v-if="branch.ahead > 0" variant="outline" class="text-[10px] px-1.5 py-0 gap-0.5 text-blue-500 border-blue-500/30">
                  <ArrowUp class="h-2.5 w-2.5" />
                  {{ branch.ahead }}
                </Badge>
                <Badge v-if="branch.behind > 0" variant="outline" class="text-[10px] px-1.5 py-0 gap-0.5 text-orange-500 border-orange-500/30">
                  <ArrowDown class="h-2.5 w-2.5" />
                  {{ branch.behind }}
                </Badge>
              </div>
            </div>
          </div>

          <!-- Merge into main button -->
          <Button
            v-if="git.currentBranch !== 'main' && /^v\d+$/.test(git.currentBranch)"
            variant="outline"
            size="sm"
            class="w-full mt-3 gap-1.5"
            :disabled="isMerging || git.ahead > 0"
            data-testid="merge-into-main"
            @click="mergeIntoMain"
          >
            <GitMerge class="h-3.5 w-3.5" />
            {{ isMerging ? 'Merging...' : `Publish ${git.currentBranch} to main` }}
          </Button>
        </div>
      </div>

      <!-- Activity (2/5 width) -->
      <div class="lg:col-span-2 lg:pl-5 pt-4 lg:pt-0 border-t lg:border-t-0 border-border">
        <h3 class="text-sm font-medium text-muted-foreground mb-3">Activity</h3>
        <ActivityFeed />
      </div>
    </div>

    <!-- Dialogs -->
    <CreateVersionDialog v-model:open="showCreateVersionDialog" />

    <Dialog v-model:open="showPushDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Push to GitHub</DialogTitle>
          <DialogDescription>
            Create a GitHub repository and push this project.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">Repository Name</label>
            <Input
              v-model="pushRepoName"
              placeholder="my-literature-review"
              :disabled="isPushing"
              data-testid="push-repo-name-input"
            />
          </div>
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              class="text-xs h-7 px-2"
              :disabled="isPushing"
              data-testid="push-toggle-visibility"
              @click="isPushPrivate = !isPushPrivate"
            >
              <Lock v-if="isPushPrivate" class="h-3.5 w-3.5 mr-1" />
              <Globe v-else class="h-3.5 w-3.5 mr-1" />
              {{ isPushPrivate ? 'Private' : 'Public' }}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="isPushing" @click="showPushDialog = false">
            Cancel
          </Button>
          <Button :disabled="isPushing || !pushRepoName" data-testid="submit-push-to-github" @click="pushToGitHub">
            <Loader2 v-if="isPushing" class="h-4 w-4 mr-2 animate-spin" />
            {{ isPushing ? 'Pushing...' : 'Push to GitHub' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
