import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export type Theme = 'light' | 'dark' | 'system';

export const useThemeStore = defineStore('theme', () => {
  // Load initial theme from localStorage or default to 'light'
  const stored = localStorage.getItem('theme') as Theme | null;
  const theme = ref<Theme>(stored || 'light');

  // Apply theme to document
  function applyTheme(newTheme: Theme) {
    const root = document.documentElement;

    if (newTheme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    } else {
      root.classList.toggle('dark', newTheme === 'dark');
    }
  }

  // Watch for theme changes
  watch(theme, (newTheme) => {
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
  }, { immediate: true });

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (theme.value === 'system') {
      document.documentElement.classList.toggle('dark', e.matches);
    }
  });

  function setTheme(newTheme: Theme) {
    theme.value = newTheme;
  }

  function toggleTheme() {
    if (theme.value === 'light') {
      theme.value = 'dark';
    } else if (theme.value === 'dark') {
      theme.value = 'light';
    }
  }

  return {
    theme,
    setTheme,
    toggleTheme,
  };
});
