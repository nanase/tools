import { computed } from 'vue';
import { applyColorScheme, reapplyTheme, toggleTheme, useTheme } from '@nanase/alnilam/theme';

export interface UseVuetifyThemeOptions {
  immediate?: boolean;
}

export function useVuetifyTheme(options: UseVuetifyThemeOptions = {}) {
  const theme = useTheme();
  const isDark = computed({
    get: () => theme.global.current.value.dark,
    set: (value: boolean) => applyColorScheme(theme, value ? 'dark' : 'light'),
  });
  const isLight = computed({
    get: () => !theme.global.current.value.dark,
    set: (value: boolean) => applyColorScheme(theme, value ? 'light' : 'dark'),
  });

  function reapply() {
    reapplyTheme(theme);
  }

  function toggle() {
    toggleTheme(theme);
  }

  if (options.immediate !== false) {
    reapply();
  }

  return {
    theme,
    reapply,
    toggle,
    isLight,
    isDark,
  } as const;
}
