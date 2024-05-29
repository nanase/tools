<script setup lang="ts">
import { ref } from 'vue';
import NavigationDrawer from './NavigationDrawer.vue';
import ThemeToggleButton from './ThemeToggleButton.vue';

const { pageId, toolbarTitle } = defineProps<{
  pageId: string;
  toolbarTitle?: string;
}>();

const drawer = ref<boolean>();
</script>

<template>
  <v-app>
    <NavigationDrawer v-model:opened="drawer" :pageId="pageId" />

    <v-main>
      <v-app-bar flat floating color="primary" density="compact">
        <v-app-bar-nav-icon variant="text" @click.stop="drawer = !drawer" aria-label="ナビゲーションを表示" />
        <v-toolbar-title>{{ toolbarTitle }}</v-toolbar-title>
        <template v-slot:append>
          <ThemeToggleButton />
        </template>
      </v-app-bar>

      <v-container class="bg-containerBackground">
        <slot></slot>
      </v-container>

      <slot name="footer"></slot>
    </v-main>
  </v-app>
</template>
