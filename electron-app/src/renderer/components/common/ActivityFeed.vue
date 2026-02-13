<script setup lang="ts">
import { onMounted } from 'vue';
import { useGitStore } from '@/stores/git';
import { ScrollArea } from '@/components/ui/scroll-area';

const git = useGitStore();

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

onMounted(() => {
  git.loadRecentCommits(10);
});
</script>

<template>
  <div v-if="git.recentCommits.length === 0" class="text-sm text-muted-foreground py-4 text-center">
    No recent activity
  </div>

  <ScrollArea v-else class="h-[300px]">
    <div class="relative pl-5">
      <!-- Vertical timeline line -->
      <div class="absolute left-[9px] top-1 bottom-1 w-px bg-border" />

      <div
        v-for="(commit, index) in git.recentCommits"
        :key="commit.hash"
        class="relative pb-3 last:pb-0"
      >
        <!-- Timeline dot -->
        <span
          class="absolute left-[-11px] top-1.5 h-1.5 w-1.5 rounded-full ring-2 ring-background"
          :class="index === 0 ? 'bg-primary' : 'bg-muted-foreground/30'"
        />

        <div class="min-w-0">
          <p class="text-[13px] leading-snug truncate">{{ commit.message }}</p>
          <p class="text-xs text-muted-foreground/70 mt-px">
            {{ commit.author }} · {{ formatTimeAgo(commit.date) }}
            <span class="text-muted-foreground/40 font-mono ml-0.5">{{ commit.hash.slice(0, 7) }}</span>
          </p>
        </div>
      </div>
    </div>
  </ScrollArea>
</template>
