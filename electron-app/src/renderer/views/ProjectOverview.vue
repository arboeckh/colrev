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
  Tag,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Info,
  HelpCircle,
  BookOpen,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

// Branch switching
const isSwitchingBranch = ref(false);

async function switchToBranch(branchName: string) {
  if (branchName === git.currentBranch || isSwitchingBranch.value) return;
  isSwitchingBranch.value = true;
  try {
    if (branchName === 'dev') {
      const created = await git.ensureDevBranch();
      if (!created) return;
      if (git.currentBranch === 'dev') return;
    }
    await git.switchBranch(branchName);
  } finally {
    isSwitchingBranch.value = false;
  }
}

// Merge dev into main
const isMerging = ref(false);

async function mergeDevIntoMain() {
  isMerging.value = true;
  try {
    await git.mergeDevIntoMain();
  } finally {
    isMerging.value = false;
  }
}

// Release dialog
const showReleaseDialog = ref(false);
const releaseBump = ref<'minor' | 'major'>('minor');
const releaseTitle = ref('');
const releaseNotes = ref('');
const isCreatingRelease = ref(false);

const releaseTag = computed(() => git.nextReleaseVersion(releaseBump.value));

function openReleaseDialog() {
  releaseBump.value = 'minor';
  releaseTitle.value = '';
  releaseNotes.value = '';
  showReleaseDialog.value = true;
}

async function submitRelease() {
  isCreatingRelease.value = true;
  try {
    const tag = releaseTag.value;
    const success = await git.createRelease({
      tagName: tag,
      name: releaseTitle.value || tag,
      body: releaseNotes.value,
    });
    if (success) {
      showReleaseDialog.value = false;
    }
  } finally {
    isCreatingRelease.value = false;
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

// Branch diff description
const branchDiffText = computed(() => {
  if (!git.hasDevBranch) return null;
  if (git.devAheadOfMain === 0 && git.mainAheadOfDev === 0) return 'in sync';
  const parts: string[] = [];
  if (git.devAheadOfMain > 0) {
    parts.push(`dev is ${git.devAheadOfMain} commit${git.devAheadOfMain !== 1 ? 's' : ''} ahead of main`);
  }
  if (git.mainAheadOfDev > 0) {
    parts.push(`main is ${git.mainAheadOfDev} commit${git.mainAheadOfDev !== 1 ? 's' : ''} ahead of dev`);
  }
  return parts.join(', ');
});

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Delta pipeline helpers
const STATE_COLORS: globalThis.Record<string, string> = {
  md_retrieved: 'bg-slate-400',
  md_imported: 'bg-blue-400',
  md_needs_manual_preparation: 'bg-blue-300',
  md_prepared: 'bg-indigo-400',
  md_processed: 'bg-violet-400',
  rev_prescreen_included: 'bg-purple-400',
  rev_prescreen_excluded: 'bg-gray-400',
  pdf_imported: 'bg-pink-400',
  pdf_prepared: 'bg-rose-400',
  rev_included: 'bg-emerald-400',
  rev_excluded: 'bg-gray-400',
  rev_synthesized: 'bg-green-500',
};

function getDeltaStateColor(state: string): string {
  return STATE_COLORS[state] ?? 'bg-muted-foreground/40';
}

function formatStateName(state: string): string {
  return state
    .replace(/^(md_|rev_|pdf_)/, '')
    .replace(/_/g, ' ');
}
</script>

<template>
  <TooltipProvider :delay-duration="300">
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
              <Tooltip>
                <TooltipTrigger as-child>
                  <HelpCircle class="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" class="max-w-[240px]">
                  <p class="text-xs">This project only exists on your computer. Push to GitHub to back it up and collaborate with others.</p>
                </TooltipContent>
              </Tooltip>
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

      <!-- Two-column grid: Branch Status + Releases / Activity -->
      <div class="grid grid-cols-1 lg:grid-cols-5 gap-0 pt-4">
        <!-- Branch Status & Releases (3/5 width) -->
        <div class="lg:col-span-3 lg:pr-5 lg:border-r border-border">
          <!-- Branch status section header -->
          <div class="flex items-center gap-2 mb-3">
            <h3 class="text-sm font-medium text-muted-foreground">Branches</h3>

            <!-- Workflow guide drawer -->
            <Sheet>
              <SheetTrigger as-child>
                <button class="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer">
                  <BookOpen class="h-3 w-3" />
                  How does this work?
                </button>
              </SheetTrigger>
              <SheetContent side="right" class="w-[400px] sm:w-[440px] overflow-y-auto p-6">
                <SheetHeader>
                  <SheetTitle>Development Workflow</SheetTitle>
                  <SheetDescription>How branches and releases work in CoLRev</SheetDescription>
                </SheetHeader>
                <div class="mt-6 space-y-6 text-sm">
                  <!-- Two branches -->
                  <div>
                    <h4 class="font-medium mb-2">Two branches</h4>
                    <p class="text-muted-foreground leading-relaxed">
                      Your project uses two branches to keep work organized:
                    </p>
                    <div class="mt-3 space-y-2">
                      <div class="flex gap-3 items-start p-2.5 rounded-md bg-muted/50">
                        <span class="h-2 w-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
                        <div>
                          <span class="font-mono text-xs font-medium">dev</span>
                          <p class="text-xs text-muted-foreground mt-0.5">
                            Your active workspace. All day-to-day work happens here — adding sources, screening records, extracting data. This is where you and your collaborators contribute.
                          </p>
                        </div>
                      </div>
                      <div class="flex gap-3 items-start p-2.5 rounded-md bg-muted/50">
                        <span class="h-2 w-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                        <div>
                          <span class="font-mono text-xs font-medium">main</span>
                          <p class="text-xs text-muted-foreground mt-0.5">
                            The stable version of your project. Only updated by merging from dev when you're ready to mark a milestone. Think of it as your "published" state.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <!-- Typical workflow -->
                  <div>
                    <h4 class="font-medium mb-2">Typical workflow</h4>
                    <ol class="space-y-3 text-muted-foreground">
                      <li class="flex gap-2">
                        <span class="font-mono text-xs font-medium text-foreground shrink-0 mt-0.5">1.</span>
                        <span>Work on the <span class="font-mono text-xs">dev</span> branch. Add search sources, run operations, screen papers.</span>
                      </li>
                      <li class="flex gap-2">
                        <span class="font-mono text-xs font-medium text-foreground shrink-0 mt-0.5">2.</span>
                        <span>Changes are saved automatically. If connected to GitHub, they sync to the remote so collaborators can see them.</span>
                      </li>
                      <li class="flex gap-2">
                        <span class="font-mono text-xs font-medium text-foreground shrink-0 mt-0.5">3.</span>
                        <span>When you're ready to publish a version (e.g. screening complete), switch to <span class="font-mono text-xs">main</span> and merge dev into it.</span>
                      </li>
                      <li class="flex gap-2">
                        <span class="font-mono text-xs font-medium text-foreground shrink-0 mt-0.5">4.</span>
                        <span>Create a <strong>release</strong> to publish the version (e.g. v1.0, v1.1). Releases are the official published versions of your review that others can cite and reference.</span>
                      </li>
                      <li class="flex gap-2">
                        <span class="font-mono text-xs font-medium text-foreground shrink-0 mt-0.5">5.</span>
                        <span>Switch back to <span class="font-mono text-xs">dev</span> and continue working.</span>
                      </li>
                    </ol>
                  </div>

                  <Separator />

                  <!-- Ahead/behind -->
                  <div>
                    <h4 class="font-medium mb-2">What do the arrows mean?</h4>
                    <div class="space-y-2 text-muted-foreground">
                      <div class="flex items-center gap-2">
                        <Badge variant="outline" class="text-[10px] px-1.5 py-0 gap-0.5 text-blue-500 border-blue-500/30">
                          <ArrowUp class="h-2.5 w-2.5" />
                          3
                        </Badge>
                        <span class="text-xs">You have 3 local commits not yet pushed to the remote.</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <Badge variant="outline" class="text-[10px] px-1.5 py-0 gap-0.5 text-orange-500 border-orange-500/30">
                          <ArrowDown class="h-2.5 w-2.5" />
                          2
                        </Badge>
                        <span class="text-xs">The remote has 2 commits you don't have locally yet.</span>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <!-- Releases -->
                  <div>
                    <h4 class="font-medium mb-2">About releases</h4>
                    <p class="text-muted-foreground leading-relaxed">
                      Releases are the published versions of your literature review. When you create a release from the <span class="font-mono text-xs">main</span> branch, it creates a permanent, versioned record (e.g. v1.0) on GitHub that others can cite and reference. Each release captures the exact state of your review at that point — the records, screening decisions, and extracted data.
                    </p>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          <!-- Contextual hint for first-time users -->
          <p class="text-xs text-muted-foreground/60 mb-3 -mt-1">
            <template v-if="git.isOnDev">
              You're on <span class="font-mono">dev</span> — this is where you do your work.
            </template>
            <template v-else-if="git.isOnMain">
              You're on <span class="font-mono">main</span> — the stable branch. Switch to <span class="font-mono">dev</span> to make changes.
            </template>
          </p>

          <div class="border border-border rounded-md overflow-hidden">
            <!-- Main branch row -->
            <div
              class="flex items-center justify-between py-2 px-3 transition-colors hover:bg-muted/40"
              :class="[git.isOnMain ? 'bg-muted/20' : 'cursor-pointer']"
              data-testid="branch-status-main"
              @click="!git.isOnMain && switchToBranch('main')"
            >
              <div class="flex items-center gap-2">
                <span
                  class="h-2 w-2 rounded-full shrink-0"
                  :class="git.isOnMain ? 'bg-green-500' : 'bg-muted-foreground/30'"
                />
                <span class="font-mono text-sm">main</span>
                <Badge v-if="git.isOnMain" variant="secondary" class="text-[10px] px-1.5 py-0">
                  current
                </Badge>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <HelpCircle class="h-3 w-3 text-muted-foreground/40 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" class="max-w-[200px]">
                    <p class="text-xs">Stable branch. Only updated by merging from dev.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div class="flex items-center gap-1.5">
                <Badge v-if="git.isOnMain && git.ahead > 0" variant="outline" class="text-[10px] px-1.5 py-0 gap-0.5 text-blue-500 border-blue-500/30">
                  <ArrowUp class="h-2.5 w-2.5" />
                  {{ git.ahead }}
                </Badge>
                <Badge v-if="git.isOnMain && git.behind > 0" variant="outline" class="text-[10px] px-1.5 py-0 gap-0.5 text-orange-500 border-orange-500/30">
                  <ArrowDown class="h-2.5 w-2.5" />
                  {{ git.behind }}
                </Badge>
                <Button
                  v-if="!git.isOnMain"
                  variant="ghost"
                  size="sm"
                  class="h-6 text-[10px] px-2"
                  :disabled="isSwitchingBranch"
                  data-testid="switch-to-main"
                >
                  {{ isSwitchingBranch ? 'Switching...' : 'Switch' }}
                </Button>
              </div>
            </div>

            <!-- Dev branch row -->
            <div
              class="flex items-center justify-between py-2 px-3 border-t border-border transition-colors hover:bg-muted/40"
              :class="[git.isOnDev ? 'bg-muted/20' : 'cursor-pointer']"
              data-testid="branch-status-dev"
              @click="!git.isOnDev && switchToBranch('dev')"
            >
              <div class="flex items-center gap-2">
                <span
                  class="h-2 w-2 rounded-full shrink-0"
                  :class="git.isOnDev ? 'bg-green-500' : 'bg-muted-foreground/30'"
                />
                <span class="font-mono text-sm">dev</span>
                <Badge v-if="git.isOnDev" variant="secondary" class="text-[10px] px-1.5 py-0">
                  current
                </Badge>
                <Badge v-if="!git.hasDevBranch" variant="outline" class="text-[10px] px-1.5 py-0 text-muted-foreground">
                  not created
                </Badge>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <HelpCircle class="h-3 w-3 text-muted-foreground/40 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" class="max-w-[200px]">
                    <p class="text-xs">Development branch. Do all your work here — search, screen, extract data.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div class="flex items-center gap-1.5">
                <Badge v-if="git.isOnDev && git.ahead > 0" variant="outline" class="text-[10px] px-1.5 py-0 gap-0.5 text-blue-500 border-blue-500/30">
                  <ArrowUp class="h-2.5 w-2.5" />
                  {{ git.ahead }}
                </Badge>
                <Badge v-if="git.isOnDev && git.behind > 0" variant="outline" class="text-[10px] px-1.5 py-0 gap-0.5 text-orange-500 border-orange-500/30">
                  <ArrowDown class="h-2.5 w-2.5" />
                  {{ git.behind }}
                </Badge>
                <Button
                  v-if="!git.isOnDev"
                  variant="ghost"
                  size="sm"
                  class="h-6 text-[10px] px-2"
                  :disabled="isSwitchingBranch"
                  data-testid="switch-to-dev"
                >
                  {{ isSwitchingBranch ? 'Switching...' : 'Switch' }}
                </Button>
              </div>
            </div>
          </div>

          <!-- Dev <-> Main diff -->
          <div v-if="branchDiffText" class="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
            <template v-if="branchDiffText === 'in sync'">
              <CheckCircle2 class="h-3.5 w-3.5 text-green-500" />
              <span>dev and main are in sync</span>
            </template>
            <template v-else>
              <GitBranch class="h-3.5 w-3.5" />
              <span>{{ branchDiffText }}</span>
            </template>
          </div>

          <!-- Actions when on main -->
          <div v-if="git.isOnMain" class="mt-4 space-y-4">
            <!-- Merge dev into main -->
            <div v-if="git.hasDevBranch && git.devAheadOfMain > 0">
              <Button
                variant="outline"
                size="sm"
                class="w-full gap-1.5"
                :disabled="isMerging"
                data-testid="merge-dev-into-main"
                @click="mergeDevIntoMain"
              >
                <GitMerge class="h-3.5 w-3.5" />
                {{ isMerging ? 'Merging...' : `Merge dev into main (${git.devAheadOfMain} commit${git.devAheadOfMain !== 1 ? 's' : ''})` }}
              </Button>
              <p class="text-[11px] text-muted-foreground/50 mt-1.5">
                This brings all your work from dev into main, marking it as stable.
              </p>
            </div>

            <!-- Releases section (GitHub only) -->
            <template v-if="isGitHubRemote">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-medium text-muted-foreground">Releases</h3>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <HelpCircle class="h-3 w-3 text-muted-foreground/40 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" class="max-w-[220px]">
                      <p class="text-xs">Releases are the published versions of your review (e.g. v1.0). Each release is a permanent, citable record on GitHub.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7 text-xs gap-1"
                  data-testid="new-release-button"
                  @click="openReleaseDialog"
                >
                  <Tag class="h-3.5 w-3.5" />
                  New Release
                </Button>
              </div>

              <!-- Releases list -->
              <div v-if="git.isLoadingReleases || !git.releasesLoaded" class="flex items-center justify-center py-4">
                <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
              </div>

              <div v-else-if="git.releases.length === 0" class="flex flex-col items-center justify-center py-6 text-center">
                <Tag class="h-7 w-7 text-muted-foreground/30 mb-2" />
                <p class="text-sm text-muted-foreground">No releases yet</p>
                <p class="text-xs text-muted-foreground/60 mt-0.5">Publish a version of your review to create a citable record</p>
              </div>

              <div v-else class="border border-border rounded-md overflow-hidden">
                <a
                  v-for="(release, index) in git.releases"
                  :key="release.id"
                  :href="release.htmlUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex items-center justify-between py-2 px-3 hover:bg-muted/40 transition-colors cursor-pointer no-underline text-inherit"
                  :class="index > 0 ? 'border-t border-border' : ''"
                  :data-testid="`release-${release.tagName}`"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <Tag class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span class="font-mono text-sm font-medium">{{ release.tagName }}</span>
                    <span v-if="release.name !== release.tagName" class="text-xs text-muted-foreground truncate">
                      {{ release.name }}
                    </span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span class="text-xs text-muted-foreground">{{ formatDate(release.createdAt) }}</span>
                    <ExternalLink class="h-3 w-3 text-muted-foreground" />
                  </div>
                </a>
              </div>
            </template>

            <!-- No GitHub remote -->
            <div v-else-if="!remoteUrl" class="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Info class="h-3.5 w-3.5" />
              Connect to GitHub to manage releases and collaborate
            </div>
          </div>

          <!-- Delta summary when on dev -->
          <div v-if="git.isOnDev" class="mt-4">
            <!-- Loading state -->
            <div v-if="git.isLoadingDelta" class="p-3 rounded-md bg-muted/30 border border-border/50 flex items-center gap-2">
              <Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span class="text-xs text-muted-foreground">Comparing with main...</span>
            </div>

            <!-- Delta data available -->
            <template v-else-if="git.branchDelta">
              <!-- Has changes -->
              <div v-if="git.branchDelta.new_record_count > 0 || git.branchDelta.changed_record_count > 0 || git.branchDelta.removed_record_count > 0"
                class="rounded-md border border-border/50 overflow-hidden">
                <!-- Stats row -->
                <div class="flex divide-x divide-border/50">
                  <div v-if="git.branchDelta.new_record_count > 0" class="flex-1 p-3 text-center">
                    <div class="text-lg font-semibold text-amber-500">+{{ git.branchDelta.new_record_count }}</div>
                    <div class="text-[11px] text-muted-foreground">New records</div>
                  </div>
                  <div v-if="git.branchDelta.changed_record_count > 0" class="flex-1 p-3 text-center">
                    <div class="text-lg font-semibold text-blue-500">{{ git.branchDelta.changed_record_count }}</div>
                    <div class="text-[11px] text-muted-foreground">Progressed</div>
                  </div>
                  <div v-if="git.branchDelta.removed_record_count > 0" class="flex-1 p-3 text-center">
                    <div class="text-lg font-semibold text-red-500">-{{ git.branchDelta.removed_record_count }}</div>
                    <div class="text-[11px] text-muted-foreground">Removed</div>
                  </div>
                </div>

                <!-- Pipeline progress bar for new records -->
                <div v-if="Object.keys(git.branchDelta.delta_by_state).length > 0" class="px-3 pb-3">
                  <div class="text-[11px] text-muted-foreground mb-1.5">New records in pipeline</div>
                  <div class="flex h-2 rounded-full overflow-hidden bg-muted/50">
                    <div
                      v-for="(count, state) in git.branchDelta.delta_by_state"
                      :key="state"
                      :style="{ width: `${(count / git.branchDelta.new_record_count) * 100}%` }"
                      :class="getDeltaStateColor(String(state))"
                      class="h-full transition-all"
                      :title="`${state}: ${count}`"
                    />
                  </div>
                  <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                    <span v-for="(count, state) in git.branchDelta.delta_by_state" :key="state" class="text-[10px] text-muted-foreground flex items-center gap-1">
                      <span class="h-1.5 w-1.5 rounded-full" :class="getDeltaStateColor(String(state))" />
                      {{ formatStateName(String(state)) }}: {{ count }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- In sync -->
              <div v-else class="p-3 rounded-md bg-muted/30 border border-border/50 flex items-center gap-2">
                <CheckCircle2 class="h-3.5 w-3.5 text-green-500" />
                <span class="text-xs text-muted-foreground">Branches in sync — no new records since last merge.</span>
              </div>
            </template>

            <!-- No delta data / fallback hint -->
            <div v-else class="p-3 rounded-md bg-muted/30 border border-border/50">
              <p class="text-xs text-muted-foreground">
                <span class="font-medium text-foreground">You're on dev</span> — all your work (searching, screening, data extraction) happens here. When you're ready to mark a milestone, switch to <span class="font-mono">main</span> and merge.
              </p>
            </div>
          </div>
        </div>

        <!-- Activity (2/5 width) -->
        <div class="lg:col-span-2 lg:pl-5 pt-4 lg:pt-0 border-t lg:border-t-0 border-border">
          <div class="flex items-center gap-2 mb-3">
            <h3 class="text-sm font-medium text-muted-foreground">Activity</h3>
            <Tooltip>
              <TooltipTrigger as-child>
                <HelpCircle class="h-3 w-3 text-muted-foreground/40 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" class="max-w-[200px]">
                <p class="text-xs">Recent changes made to this project, including operations run by you and your collaborators.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <ActivityFeed />
        </div>
      </div>

      <!-- New Release Dialog -->
      <Dialog v-model:open="showReleaseDialog">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Release</DialogTitle>
            <DialogDescription>
              Publish a new version of your review. This creates a permanent, citable record on GitHub.
            </DialogDescription>
          </DialogHeader>
          <div class="space-y-4 py-4">
            <!-- Version bump toggle -->
            <div class="space-y-2">
              <label class="text-sm font-medium">Version</label>
              <div class="flex items-center gap-2">
                <Button
                  :variant="releaseBump === 'minor' ? 'default' : 'outline'"
                  size="sm"
                  class="text-xs h-7"
                  @click="releaseBump = 'minor'"
                >
                  Minor ({{ git.nextReleaseVersion('minor') }})
                </Button>
                <Button
                  :variant="releaseBump === 'major' ? 'default' : 'outline'"
                  size="sm"
                  class="text-xs h-7"
                  @click="releaseBump = 'major'"
                >
                  Major ({{ git.nextReleaseVersion('major') }})
                </Button>
              </div>
              <p class="text-xs text-muted-foreground">
                <span class="font-mono">{{ releaseTag }}</span>
                — use minor for updates (e.g. added sources), major for significant new versions.
              </p>
            </div>

            <!-- Title -->
            <div class="space-y-2">
              <label class="text-sm font-medium">Title</label>
              <Input
                v-model="releaseTitle"
                :placeholder="releaseTag"
                :disabled="isCreatingRelease"
                data-testid="release-title-input"
              />
            </div>

            <!-- Notes -->
            <div class="space-y-2">
              <label class="text-sm font-medium">Release Notes <span class="text-muted-foreground font-normal">(optional)</span></label>
              <Textarea
                v-model="releaseNotes"
                placeholder="Describe what's changed..."
                :disabled="isCreatingRelease"
                rows="4"
                data-testid="release-notes-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" :disabled="isCreatingRelease" @click="showReleaseDialog = false">
              Cancel
            </Button>
            <Button
              :disabled="isCreatingRelease"
              data-testid="submit-create-release"
              @click="submitRelease"
            >
              <Loader2 v-if="isCreatingRelease" class="h-4 w-4 mr-2 animate-spin" />
              {{ isCreatingRelease ? 'Creating...' : `Create ${releaseTag}` }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- Push to GitHub Dialog -->
      <Dialog v-model:open="showPushDialog">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Push to GitHub</DialogTitle>
            <DialogDescription>
              Create a GitHub repository and push this project. This enables collaboration and backup.
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
  </TooltipProvider>
</template>
