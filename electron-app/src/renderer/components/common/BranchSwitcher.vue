<script setup lang="ts">
import { ref } from 'vue';
import { GitBranch, Check, ChevronDown, Shield, Code } from 'lucide-vue-next';
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
import { useGitStore } from '@/stores/git';

const git = useGitStore();

const isSwitching = ref(false);

async function handleSwitch(branchName: string) {
  if (branchName === git.currentBranch || isSwitching.value) return;
  isSwitching.value = true;
  try {
    if (branchName === 'dev') {
      // Ensure dev branch exists before switching
      const created = await git.ensureDevBranch();
      if (!created) return;
      // If ensureDevBranch just created it, we're already on dev
      if (git.currentBranch === 'dev') return;
    }
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
      <DropdownMenuLabel>Branches</DropdownMenuLabel>

      <!-- Main branch -->
      <DropdownMenuItem
        class="gap-2 font-mono text-xs"
        data-testid="branch-option-main"
        @click="handleSwitch('main')"
      >
        <Check
          class="h-3.5 w-3.5"
          :class="git.isOnMain ? 'opacity-100' : 'opacity-0'"
        />
        main
        <Badge variant="outline" class="ml-auto text-[10px] px-1 py-0 gap-0.5">
          <Shield class="h-2.5 w-2.5" />
          stable
        </Badge>
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <!-- Dev branch -->
      <DropdownMenuItem
        class="gap-2 font-mono text-xs"
        data-testid="branch-option-dev"
        @click="handleSwitch('dev')"
      >
        <Check
          class="h-3.5 w-3.5"
          :class="git.isOnDev ? 'opacity-100' : 'opacity-0'"
        />
        dev
        <Badge variant="secondary" class="ml-auto text-[10px] px-1 py-0 gap-0.5">
          <Code class="h-2.5 w-2.5" />
          development
        </Badge>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
