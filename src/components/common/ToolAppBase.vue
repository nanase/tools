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
      <slot name="mainPrepend"><NavigationDrawer v-model:opened="drawerOpened" :pageId /></slot>
    </template>
    <template #appbarPrepend>
      <slot name="appbarPrepend">
        <v-app-bar-nav-icon
          variant="text"
          @click.stop="drawerOpened = !drawerOpened"
          aria-label="ナビゲーションを表示"
        />
      </slot>
    </template>
    <template #errorSnackbar>
      <slot name="errorSnackbar"></slot>
    </template>
    <template #appbarAppend>
      <slot name="appbarAppend"></slot>
    </template>
    <template #toolbarPrepend>
      <slot name="toolbarPrepend"></slot>
    </template>
    <template #toolbarAppend>
      <slot name="toolbarAppend"></slot>
    </template>
    <template #header>
      <slot name="header"></slot>
    </template>

    <slot></slot>

    <template #footer>
      <slot name="footer"></slot>
    </template>
    <template #mainAppend>
      <slot name="mainAppend"></slot>
    </template>
  </AppBase>
</template>
