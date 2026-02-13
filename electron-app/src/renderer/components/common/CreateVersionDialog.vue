<script setup lang="ts">
import { ref, computed } from 'vue';
import { GitBranch, Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGitStore } from '@/stores/git';

const open = defineModel<boolean>('open', { default: false });

const git = useGitStore();
const isCreating = ref(false);

const versionName = computed(() => git.nextVersionName);

const baseBranch = computed(() => {
  // First version branches from main, subsequent from latest version
  if (git.versionBranches.length === 0) return 'main';
  return git.versionBranches[git.versionBranches.length - 1].name;
});

async function create() {
  isCreating.value = true;
  try {
    const success = await git.createVersion(baseBranch.value);
    if (success) {
      open.value = false;
    }
  } finally {
    isCreating.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create New Version</DialogTitle>
        <DialogDescription>
          Create a new version branch to start working on changes.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <div class="flex items-center gap-3 p-3 bg-muted rounded-lg">
          <GitBranch class="h-5 w-5 text-muted-foreground shrink-0" />
          <div>
            <p class="font-mono font-medium">{{ versionName }}</p>
            <p class="text-xs text-muted-foreground">
              Based on <span class="font-mono">{{ baseBranch }}</span>
            </p>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="isCreating" @click="open = false">
          Cancel
        </Button>
        <Button
          :disabled="isCreating"
          data-testid="submit-create-version"
          @click="create"
        >
          <Loader2 v-if="isCreating" class="h-4 w-4 mr-2 animate-spin" />
          {{ isCreating ? 'Creating...' : `Create ${versionName}` }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
