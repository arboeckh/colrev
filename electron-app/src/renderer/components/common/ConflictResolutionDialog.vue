<script setup lang="ts">
import { reactive, ref, computed } from 'vue';
import { Check, User, Users } from 'lucide-vue-next';
import { Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useGitStore } from '@/stores/git';
import type { MergeConflictResolution } from '@/types/window';

const git = useGitStore();

// Track user's choices: conflict id → 'local' | 'remote'
// Using a reactive plain object instead of Map for Vue reactivity
const choices = reactive<Record<string, 'local' | 'remote'>>({});

const allResolved = computed(() => {
  if (!git.mergeAnalysis) return false;
  return git.mergeAnalysis.conflicts.every((c) => c.id in choices);
});

const isApplying = ref(false);

function selectChoice(conflictId: string, choice: 'local' | 'remote') {
  choices[conflictId] = choice;
}

function selectAllLocal() {
  if (!git.mergeAnalysis) return;
  for (const conflict of git.mergeAnalysis.conflicts) {
    choices[conflict.id] = 'local';
  }
}

function selectAllRemote() {
  if (!git.mergeAnalysis) return;
  for (const conflict of git.mergeAnalysis.conflicts) {
    choices[conflict.id] = 'remote';
  }
}

async function applyResolutions() {
  if (!git.mergeAnalysis || !allResolved.value) return;

  isApplying.value = true;
  try {
    const resolutions: MergeConflictResolution[] = git.mergeAnalysis.conflicts.map((c) => ({
      id: c.id,
      choice: choices[c.id] || 'local',
    }));
    await git.applyMergeResolutions(resolutions);
    clearChoices();
  } finally {
    isApplying.value = false;
  }
}

function clearChoices() {
  for (const key of Object.keys(choices)) {
    delete choices[key];
  }
}

function cancel() {
  clearChoices();
  git.cancelMerge();
}

function handleOpenChange(open: boolean) {
  if (!open) cancel();
}

function formatValue(value: unknown, formatted?: string): string {
  if (formatted) return formatted;
  if (value === null || value === undefined) return '(empty)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value || '(empty)';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '(empty list)';
    if (typeof value[0] === 'string') return value.join(', ');
    return `${value.length} item(s)`;
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
</script>

<template>
  <Dialog :open="git.showConflictDialog" @update:open="handleOpenChange">
    <DialogScrollContent class="sm:max-w-[700px]">
      <DialogHeader>
        <DialogTitle>Resolve Conflicting Changes</DialogTitle>
        <DialogDescription>
          You and a collaborator both changed some settings.
          Choose which version to keep for each item below.
        </DialogDescription>
      </DialogHeader>

      <div v-if="git.mergeAnalysis" class="space-y-4 py-2">
        <!-- Bulk actions -->
        <div v-if="git.mergeAnalysis.conflicts.length > 1" class="flex items-center gap-2">
          <span class="text-sm text-muted-foreground">Quick select:</span>
          <Button variant="outline" size="sm" @click="selectAllLocal">
            Keep all yours
          </Button>
          <Button variant="outline" size="sm" @click="selectAllRemote">
            Keep all theirs
          </Button>
        </div>

        <!-- Conflict cards -->
        <Card
          v-for="conflict in git.mergeAnalysis.conflicts"
          :key="conflict.id"
          class="border-orange-500/30"
        >
          <CardHeader class="pb-2">
            <CardTitle class="text-base">
              {{ conflict.label }}
            </CardTitle>
            <p v-if="conflict.description" class="text-sm text-muted-foreground">
              {{ conflict.description }}
            </p>
          </CardHeader>
          <CardContent>
            <div class="grid grid-cols-2 gap-3">
              <!-- Your version -->
              <button
                class="flex flex-col gap-1.5 p-3 border rounded-lg text-left transition-all hover:bg-accent/50"
                :class="choices[conflict.id] === 'local'
                  ? 'ring-2 ring-primary border-primary bg-primary/5'
                  : 'border-border'"
                @click="selectChoice(conflict.id, 'local')"
              >
                <div class="flex items-center gap-1.5">
                  <User class="h-3.5 w-3.5 text-muted-foreground" />
                  <span class="text-xs font-medium text-muted-foreground">Your version</span>
                  <Check
                    v-if="choices[conflict.id] === 'local'"
                    class="h-3.5 w-3.5 text-primary ml-auto"
                  />
                </div>
                <span class="text-sm font-medium break-words">
                  {{ formatValue(conflict.localValue, conflict.localLabel) }}
                </span>
              </button>

              <!-- Their version -->
              <button
                class="flex flex-col gap-1.5 p-3 border rounded-lg text-left transition-all hover:bg-accent/50"
                :class="choices[conflict.id] === 'remote'
                  ? 'ring-2 ring-primary border-primary bg-primary/5'
                  : 'border-border'"
                @click="selectChoice(conflict.id, 'remote')"
              >
                <div class="flex items-center gap-1.5">
                  <Users class="h-3.5 w-3.5 text-muted-foreground" />
                  <span class="text-xs font-medium text-muted-foreground">Collaborator's version</span>
                  <Check
                    v-if="choices[conflict.id] === 'remote'"
                    class="h-3.5 w-3.5 text-primary ml-auto"
                  />
                </div>
                <span class="text-sm font-medium break-words">
                  {{ formatValue(conflict.remoteValue, conflict.remoteLabel) }}
                </span>
              </button>
            </div>
          </CardContent>
        </Card>

        <!-- Auto-merged summary -->
        <div v-if="git.mergeAnalysis.autoMerged.length > 0">
          <Separator class="my-3" />
          <details class="text-sm">
            <summary class="cursor-pointer text-muted-foreground hover:text-foreground">
              {{ git.mergeAnalysis.autoMerged.length }} change(s) merged automatically
            </summary>
            <ul class="mt-2 space-y-1 pl-4 text-muted-foreground">
              <li v-for="(change, i) in git.mergeAnalysis.autoMerged" :key="i" class="flex items-center gap-2">
                <Check class="h-3 w-3 text-green-500 shrink-0" />
                <span>{{ change.label }}</span>
                <span class="text-xs">({{ change.source === 'local' ? 'your change' : "collaborator's change" }})</span>
              </li>
            </ul>
          </details>
        </div>
      </div>

      <DialogFooter class="gap-2">
        <Button variant="outline" :disabled="isApplying" @click="cancel">
          Cancel
        </Button>
        <Button :disabled="!allResolved || isApplying" @click="applyResolutions">
          <template v-if="isApplying">Applying...</template>
          <template v-else>Apply</template>
        </Button>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>
</template>
