<script setup lang="ts">
import { ref } from 'vue';
import { GitBranch, Check, ChevronDown, Plus, Shield } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import CreateVersionDialog from './CreateVersionDialog.vue';
import { useGitStore } from '@/stores/git';

const git = useGitStore();

const showCreateDialog = ref(false);
const isSwitching = ref(false);

async function handleSwitch(branchName: string) {
  if (branchName === git.currentBranch || isSwitching.value) return;
  isSwitching.value = true;
  try {
    await git.switchBranch(branchName);
  } finally {
    isSwitching.value = false;
  }
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="gap-1.5 font-mono text-xs h-8"
        data-testid="branch-switcher"
        :disabled="isSwitching"
      >
        <GitBranch class="h-3.5 w-3.5" />
        {{ git.currentBranch }}
        <ChevronDown class="h-3 w-3 opacity-50" />
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent align="start" class="w-56">
      <!-- Version branches -->
      <DropdownMenuLabel v-if="git.versionBranches.length > 0">
        Versions
      </DropdownMenuLabel>
      <DropdownMenuItem
        v-for="branch in git.versionBranches"
        :key="branch.name"
        class="gap-2 font-mono text-xs"
        :data-testid="`branch-option-${branch.name}`"
        @click="handleSwitch(branch.name)"
      >
        <Check
          class="h-3.5 w-3.5"
          :class="branch.name === git.currentBranch ? 'opacity-100' : 'opacity-0'"
        />
        {{ branch.name }}
        <Badge v-if="branch.ahead > 0" variant="secondary" class="ml-auto text-[10px] px-1 py-0">
          {{ branch.ahead }}&#8593;
        </Badge>
      </DropdownMenuItem>

      <DropdownMenuSeparator v-if="git.versionBranches.length > 0" />

      <!-- Main branch -->
      <DropdownMenuLabel>Main</DropdownMenuLabel>
      <DropdownMenuItem
        class="gap-2 font-mono text-xs"
        data-testid="branch-option-main"
        @click="handleSwitch('main')"
      >
        <Check
          class="h-3.5 w-3.5"
          :class="git.currentBranch === 'main' ? 'opacity-100' : 'opacity-0'"
        />
        main
        <Badge variant="outline" class="ml-auto text-[10px] px-1 py-0 gap-0.5">
          <Shield class="h-2.5 w-2.5" />
          protected
        </Badge>
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <!-- Create new version -->
      <DropdownMenuItem
        class="gap-2 text-xs"
        data-testid="create-new-version"
        @click="showCreateDialog = true"
      >
        <Plus class="h-3.5 w-3.5" />
        New version...
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  <CreateVersionDialog v-model:open="showCreateDialog" />
</template>
