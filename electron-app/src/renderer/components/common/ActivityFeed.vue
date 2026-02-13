<script setup lang="ts">
import { onMounted } from 'vue';
import { History } from 'lucide-vue-next';
import { useGitStore } from '@/stores/git';

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
  git.loadRecentCommits(8);
});
</script>

<template>
  <div v-if="git.recentCommits.length > 0" class="space-y-3">
    <h3 class="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
      <History class="h-3.5 w-3.5" />
      Recent Activity
    </h3>

    <div class="space-y-0">
      <div
        v-for="commit in git.recentCommits"
        :key="commit.hash"
        class="flex items-start gap-2 py-1.5 text-xs"
      >
        <span class="text-muted-foreground font-medium shrink-0 w-16 text-right">
          {{ formatTimeAgo(commit.date) }}
        </span>
        <span class="text-muted-foreground">·</span>
        <div class="min-w-0">
          <span class="text-foreground">{{ commit.author }}</span>
          <span class="text-muted-foreground">: {{ commit.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
