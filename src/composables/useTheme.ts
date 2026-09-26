import { computed, ref, watch } from 'vue';
import { usePreferredDark, useLocalStorage } from '@vueuse/core';

const STORAGE_KEY = 'color-scheme';

function getInitialDark(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const isDarkGlobal = ref(getInitialDark());

function applyTheme(dark: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.backgroundColor = dark ? '#121212' : '#ffffff';
}

export function useTheme() {
  const prefersDark = usePreferredDark();
  const stored = useLocalStorage(STORAGE_KEY, prefersDark.value ? 'dark' : 'light');

  const isDark = computed({
    get: () => isDarkGlobal.value,
    set: (value: boolean) => {
      isDarkGlobal.value = value;
      stored.value = value ? 'dark' : 'light';
      applyTheme(value);
    },
  });

  function toggle() {
    isDark.value = !isDark.value;
  }

  watch(isDarkGlobal, applyTheme, { immediate: true });

  return { isDark, toggle };
}
