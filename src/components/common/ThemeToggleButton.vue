<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';
import { useTheme } from 'vuetify';
import { VuetifyColorSchemeName, applyColorScheme, reapplyTheme, toggleTheme } from '@/lib/theme';

const theme = useTheme();

function onSchemeChanged(event: MediaQueryListEvent) {
  const colorScheme = localStorage.getItem(VuetifyColorSchemeName);

  if (colorScheme === null) {
    applyColorScheme(theme, event.matches ? 'dark' : 'light');
  } else if ((colorScheme === 'dark' && event.matches) || (colorScheme === 'light' && !event.matches)) {
    localStorage.removeItem(VuetifyColorSchemeName);
  }
}

function onClickToggleTheme() {
  toggleTheme(theme);
}

onMounted(() => {
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onSchemeChanged);
  }

  reapplyTheme(theme);
});

onBeforeUnmount(() => {
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', onSchemeChanged);
  }
});
</script>

<template>
  <v-tooltip text="テーマを切り替え" aria-label="テーマを切り替え">
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        :icon="theme.global.current.value.dark ? 'mdi-weather-night' : 'mdi-white-balance-sunny'"
        @click="onClickToggleTheme"
        aria-label="テーマを切り替え"
      />
    </template>
  </v-tooltip>
</template>
