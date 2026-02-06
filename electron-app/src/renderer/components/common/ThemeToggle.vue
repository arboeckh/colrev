<script setup lang="ts">
import { Sun, Moon } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useThemeStore } from '@/stores/theme';

const themeStore = useThemeStore();
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    data-testid="theme-toggle"
    @click="themeStore.toggleTheme()"
  >
    <Sun v-if="themeStore.theme === 'dark'" class="h-5 w-5" />
    <Moon v-else class="h-5 w-5" />
    <span class="sr-only">Toggle theme</span>
  </Button>
</template>
