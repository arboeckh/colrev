<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowRight,
  Github,
  Globe,
  ExternalLink,
  Loader2,
  HardDrive,
  Tag,
  CheckCircle2,
  Info,
  HelpCircle,
  UserPlus,
  User,
} from 'lucide-vue-next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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

// Publish (merge dev into main)
const isPublishing = ref(false);

async function publishVersion() {
  isPublishing.value = true;
  try {
    await git.mergeDevIntoMain();
    // After merge, switch back to dev automatically
    if (git.isOnMain) {
      await git.switchBranch('dev');
    }
  } finally {
    isPublishing.value = false;
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

// Collaborators
import type { GitHubCollaborator, PendingRepoInvitation } from '@/types/window';

const collaborators = ref<GitHubCollaborator[]>([]);
const pendingInvitations = ref<PendingRepoInvitation[]>([]);
const isLoadingCollaborators = ref(false);
const showInviteForm = ref(false);
const inviteUsername = ref('');
const isInviting = ref(false);

async function loadCollaborators() {
  if (!remoteUrl.value || !isGitHubRemote.value) return;
  isLoadingCollaborators.value = true;
  try {
    const [collabResult, invResult] = await Promise.all([
      window.github.listCollaborators({ remoteUrl: remoteUrl.value }),
      window.github.listPendingInvitations({ remoteUrl: remoteUrl.value }),
    ]);
    if (collabResult.success) {
      collaborators.value = collabResult.collaborators;
    }
    if (invResult.success) {
      // Filter out anyone who's already in the collaborators list
      const collabLogins = new Set(collaborators.value.map((c) => c.login));
      pendingInvitations.value = invResult.invitations.filter(
        (inv) => !collabLogins.has(inv.inviteeLogin),
      );
    }
  } finally {
    isLoadingCollaborators.value = false;
  }
}

async function inviteCollaborator() {
  if (!inviteUsername.value || !remoteUrl.value) return;
  isInviting.value = true;
  try {
    const result = await window.github.addCollaborator({
      remoteUrl: remoteUrl.value,
      username: inviteUsername.value,
    });
    if (result.success) {
      const msg = result.invited
        ? `Invitation sent to ${inviteUsername.value}`
        : `${inviteUsername.value} is already a collaborator`;
      notifications.success('Collaborator added', msg);
      inviteUsername.value = '';
      showInviteForm.value = false;
      await loadCollaborators();
    } else {
      notifications.error('Invite failed', result.error || 'Unknown error');
    }
  } catch (err) {
    notifications.error('Invite failed', err instanceof Error ? err.message : 'Unknown error');
  } finally {
    isInviting.value = false;
  }
}

// Load collaborators on mount (fire-and-forget)
loadCollaborators();

const totalRecords = computed(() => projects.currentStatus?.total_records ?? 0);

// Next recommended step
const nextStep = computed(() => {
  let next = projects.nextOperation;
  if (!next) return null;
  if (['load', 'prep', 'dedupe'].includes(next)) next = 'preprocessing';
  return WORKFLOW_STEPS.find((s) => s.id === next) || null;
});

function navigateToStep(stepRoute: string) {
  if (projects.currentProjectId) {
    router.push(`/project/${projects.currentProjectId}/${stepRoute}`);
  }
}

// Unpublished changes description
const unpublishedChangesText = computed(() => {
  if (!git.hasDevBranch) return null;
  if (git.devAheadOfMain === 0) return null;
  return `${git.devAheadOfMain} unpublished change${git.devAheadOfMain !== 1 ? 's' : ''}`;
});

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Existing records on main that reached data extraction
const mainSynthesizedCount = computed(() => {
  const currently = projects.currentStatus?.currently;
  const deltaNew = git.branchDelta?.delta_by_state?.rev_synthesized ?? 0;
  if (!currently) return 0;
  return (currently.rev_synthesized ?? 0) - deltaNew;
});

// New record funnel: cumulative counts that passed each gate
// States that indicate a record has passed each stage (included):
const PRESCREEN_PASSED = [
  'rev_prescreen_included', 'pdf_needs_manual_retrieval', 'pdf_imported',
  'pdf_not_available', 'pdf_needs_manual_preparation', 'pdf_prepared',
  'rev_included', 'rev_synthesized',
];
const SCREEN_PASSED = ['rev_included', 'rev_synthesized'];
const DATA_EXTRACTED = ['rev_synthesized'];

function sumDeltaStates(deltaByState: globalThis.Record<string, number>, states: string[]): number {
  return states.reduce((sum, s) => sum + (deltaByState[s] ?? 0), 0);
}

const newRecordFunnel = computed(() => {
  const delta = git.branchDelta;
  if (!delta || delta.new_record_count === 0) return null;
  const d = delta.delta_by_state;
  return [
    { label: 'Searched', count: delta.new_record_count },
    { label: 'Prescreened', count: sumDeltaStates(d, PRESCREEN_PASSED) },
    { label: 'Screened', count: sumDeltaStates(d, SCREEN_PASSED) },
    { label: 'Synthesized', count: sumDeltaStates(d, DATA_EXTRACTED) },
  ];
});
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="p-6 max-w-4xl">
      <!-- Header area -->
      <div class="pb-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-xl font-semibold">
              {{ projects.currentSettings?.project?.title || 'Literature Review' }}
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
                  <p class="text-xs">This review only exists on your computer. Push to GitHub to back it up and collaborate with others.</p>
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

      <!-- Two-column grid: Versions + Activity -->
      <div class="grid grid-cols-1 lg:grid-cols-5 gap-0 pt-4">
        <!-- Versions & Publishing (3/5 width) -->
        <div class="lg:col-span-3 lg:pr-5 lg:border-r border-border">
          <!-- Publish section -->
          <div class="flex items-center gap-2 mb-3">
            <h3 class="text-sm font-medium text-muted-foreground">Publishing</h3>
          </div>

          <!-- Unpublished changes -->
          <div v-if="git.isLoadingDelta" class="p-3 rounded-md bg-muted/30 border border-border/50 flex items-center gap-2">
            <Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span class="text-xs text-muted-foreground">Checking for unpublished changes...</span>
          </div>

          <template v-else-if="git.branchDelta">
            <!-- Has unpublished changes -->
            <div v-if="git.branchDelta.new_record_count > 0 || git.branchDelta.removed_record_count > 0"
              class="rounded-md border border-border/50 overflow-hidden p-3 space-y-3">

              <!-- Records included in review (published) -->
              <div v-if="mainSynthesizedCount > 0" class="flex items-baseline gap-1.5">
                <span class="text-2xl font-semibold text-foreground">{{ mainSynthesizedCount }}</span>
                <span class="text-sm text-muted-foreground">record{{ mainSynthesizedCount !== 1 ? 's' : '' }} included in review</span>
              </div>
              <div v-else class="text-sm text-muted-foreground">No records included in review yet</div>

              <!-- New records breadcrumb funnel -->
              <div v-if="newRecordFunnel">
                <div class="text-[11px] text-muted-foreground mb-1.5">+{{ git.branchDelta.new_record_count }} new record{{ git.branchDelta.new_record_count !== 1 ? 's' : '' }} — funnel shows progress through each stage</div>
                <div class="flex items-center gap-1">
                  <template v-for="(stage, i) in newRecordFunnel" :key="stage.label">
                    <ArrowRight v-if="i > 0" class="h-3 w-3 text-muted-foreground/40 shrink-0" />
                    <div class="flex flex-col items-center gap-0.5">
                      <div
                        class="rounded-full px-2.5 pb-1 leading-none"
                        :class="stage.count > 0 ? 'bg-muted/60 text-foreground' : 'bg-muted/30 text-muted-foreground/40'"
                      >
                        <span class="text-[10px] leading-none">{{ stage.label }}</span>
                      </div>
                      <span class="text-[10px] leading-none tabular-nums" :class="stage.count > 0 ? 'text-muted-foreground' : 'text-muted-foreground/40'">{{ stage.count }}</span>
                    </div>
                  </template>
                </div>
              </div>

              <!-- Removed records note -->
              <div v-if="git.branchDelta.removed_record_count > 0" class="text-xs text-red-500">
                -{{ git.branchDelta.removed_record_count }} removed
              </div>

              <!-- Publish button -->
              <div v-if="unpublishedChangesText" class="pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  class="w-full gap-1.5"
                  :disabled="isPublishing"
                  data-testid="publish-version"
                  @click="publishVersion"
                >
                  <Tag class="h-3.5 w-3.5" />
                  {{ isPublishing ? 'Publishing...' : `Publish (${unpublishedChangesText})` }}
                </Button>
                <p class="text-[11px] text-muted-foreground/50 mt-1.5">
                  Marks the current state of your review as a stable version.
                </p>
              </div>
            </div>

            <!-- All published / in sync -->
            <div v-else class="p-3 rounded-md bg-muted/30 border border-border/50 flex items-center gap-2">
              <CheckCircle2 class="h-3.5 w-3.5 text-green-500" />
              <span class="text-xs text-muted-foreground">All changes published — your review is up to date.</span>
            </div>
          </template>

          <!-- No delta data -->
          <div v-else class="p-3 rounded-md bg-muted/30 border border-border/50">
            <p class="text-xs text-muted-foreground">
              Work on your review by searching, screening, and extracting data. When you're ready to mark a milestone, publish a version.
            </p>
          </div>

          <!-- Collaborators section (GitHub only) -->
          <div v-if="isGitHubRemote" class="mt-5 space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-medium text-muted-foreground">Collaborators</h3>
                <Badge v-if="collaborators.length > 0" variant="secondary" class="text-xs">
                  {{ collaborators.length }}
                </Badge>
              </div>
              <Button
                v-if="!showInviteForm"
                variant="ghost"
                size="sm"
                class="gap-1.5 text-xs h-7"
                @click="showInviteForm = true"
              >
                <UserPlus class="h-3.5 w-3.5" />
                Invite
              </Button>
            </div>

            <!-- Invite form -->
            <div v-if="showInviteForm" class="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
              <UserPlus class="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                v-model="inviteUsername"
                class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                placeholder="GitHub username..."
                @keydown.enter="inviteCollaborator"
              >
              <Button
                size="sm"
                class="h-6 text-xs px-2"
                :disabled="!inviteUsername || isInviting"
                @click="inviteCollaborator"
              >
                {{ isInviting ? 'Sending...' : 'Send' }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-6 text-xs px-2"
                @click="showInviteForm = false; inviteUsername = ''"
              >
                Cancel
              </Button>
            </div>

            <!-- Collaborator list -->
            <div v-if="isLoadingCollaborators" class="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 class="h-3.5 w-3.5 animate-spin" />
              Loading collaborators...
            </div>

            <div v-else-if="collaborators.length > 0 || pendingInvitations.length > 0" class="flex flex-wrap gap-3">
              <!-- Active collaborators -->
              <Tooltip v-for="collab in collaborators" :key="collab.login">
                <TooltipTrigger as-child>
                  <div class="flex items-center gap-1.5 cursor-default">
                    <Avatar class="h-6 w-6 shrink-0">
                      <AvatarImage :src="collab.avatarUrl" />
                      <AvatarFallback class="text-[9px] bg-muted">
                        <User class="h-3 w-3" />
                      </AvatarFallback>
                    </Avatar>
                    <span class="text-xs text-muted-foreground">{{ collab.login }}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p class="text-xs">{{ collab.name || collab.login }}</p>
                </TooltipContent>
              </Tooltip>

              <!-- Pending invitations -->
              <Tooltip v-for="inv in pendingInvitations" :key="`pending-${inv.id}`">
                <TooltipTrigger as-child>
                  <div class="flex items-center gap-1.5 cursor-default opacity-50">
                    <Avatar class="h-6 w-6 shrink-0 ring-1 ring-dashed ring-amber-400/50">
                      <AvatarImage :src="inv.inviteeAvatarUrl" />
                      <AvatarFallback class="text-[9px] bg-muted">
                        <User class="h-3 w-3" />
                      </AvatarFallback>
                    </Avatar>
                    <span class="text-xs text-muted-foreground">{{ inv.inviteeLogin }}</span>
                    <Badge variant="outline" class="text-[9px] px-1 py-0 text-amber-500 border-amber-500/30">
                      pending
                    </Badge>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p class="text-xs">Invitation sent — waiting for {{ inv.inviteeLogin }} to accept</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div v-else class="text-xs text-muted-foreground py-1">
              No collaborators yet. Invite someone to start collaborating.
            </div>
          </div>

          <!-- Releases section (GitHub only) -->
          <div v-if="isGitHubRemote" class="mt-5 space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-medium text-muted-foreground">Releases</h3>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <HelpCircle class="h-3 w-3 text-muted-foreground/40 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" class="max-w-[220px]">
                    <p class="text-xs">Published versions of your review (e.g. v1.0). Each release is a permanent, citable record on GitHub.</p>
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
              <p class="text-xs text-muted-foreground/60 mt-0.5">Publish a version and create a release to get a citable record</p>
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
          </div>

          <!-- No GitHub remote -->
          <div v-else-if="!remoteUrl" class="flex items-center gap-2 text-xs text-muted-foreground py-2 mt-4">
            <Info class="h-3.5 w-3.5" />
            Connect to GitHub to manage releases and collaborate
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
                <p class="text-xs">Recent changes made to this review, including operations run by you and your collaborators.</p>
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
              Create a GitHub repository and push this review. This enables collaboration and backup.
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
