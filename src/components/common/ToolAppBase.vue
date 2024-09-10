<script setup lang="ts">
import { ref } from 'vue';
import { AppBase } from '@nanase/alnilam/components';
import NavigationDrawer from './NavigationDrawer.vue';

const { pageId, toolbarTitle } = defineProps<{
  pageId: string;
  toolbarTitle?: string;
}>();

const drawerOpened = ref<boolean>();
</script>

<template>
  <AppBase :toolbarTitle flat floating color="primary" density="compact">
    <template #mainPrepend>
      <NavigationDrawer v-model:opened="drawerOpened" :pageId />
    </template>
    <template #appbarPrepend>
      <v-app-bar-nav-icon variant="text" @click.stop="drawerOpened = !drawerOpened" aria-label="ナビゲーションを表示" />
    </template>

    <slot></slot>
  </AppBase>
</template>
