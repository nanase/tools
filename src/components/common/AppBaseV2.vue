<script setup lang="ts">
import { ref } from 'vue';
import { usePage } from '@/page';
import ShakingIcon from './ShakingIcon.vue';

const { pageId, title, icon } = defineProps<{
  pageId?: string;
  title?: string;
  icon?: string;
}>();

const errorSnackbarShown = defineModel<boolean>('errorSnackbarShown');
const { page } = usePage(pageId);
const drawerOpened = ref<boolean>();
</script>

<template>
  <v-app>
    <v-navigation-drawer
      v-if="$slots.drawerMenu"
      v-model="drawerOpened"
      floating
      aria-label="ナビゲーション"
      :width="270"
      color="v2DrawerBackground"
    >
      <v-list class="px-0 pb-0 d-flex flex-column fill-height" role="menu">
        <slot name="drawerMenu" :currentPage="page"></slot>
      </v-list>
    </v-navigation-drawer>

    <v-snackbar class="error-snackbar" v-model="errorSnackbarShown" timeout="10000" color="v2SnackbarBackground">
      <slot name="errorSnackbar">
        <v-row>
          <v-col cols="1">
            <ShakingIcon icon="mdi-alert" size="medium" color="warning" />
          </v-col>
          <v-col>データを取得できませんでした。<br />しばらくしてから再読み込みしてください。</v-col>
        </v-row>
      </slot>
      <template #actions>
        <v-btn color="red-lighten-2" variant="plain" @click="errorSnackbarShown = false">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </template>
    </v-snackbar>

    <v-main>
      <v-app-bar class="app-bar" flat floating color="v2AppBarBackground" density="comfortable">
        <slot name="appbarPrepend">
          <v-app-bar-nav-icon
            v-if="!drawerOpened"
            variant="plain"
            @click.stop="drawerOpened = !drawerOpened"
            aria-label="ナビゲーションを表示"
            :icon="icon ?? page?.icon ?? 'mdi-menu'"
          />
        </slot>
        <v-toolbar-title v-if="!drawerOpened" class="ml-1">{{ title ?? page?.title }}</v-toolbar-title>
        <template #append>
          <slot name="appbarAppend"></slot>
        </template>
      </v-app-bar>

      <slot name="header"></slot>

      <v-container>
        <slot></slot>
      </v-container>

      <slot name="footer"> </slot>
    </v-main>

    <slot name="mainAppend"></slot>
  </v-app>
</template>

<style lang="scss" scoped>
/* stylelint-disable-next-line selector-class-pattern */
.v-list-item--slim .v-list-item__prepend > .v-icon ~ :deep(.v-list-item__spacer) {
  width: 5px;
}

.v-switch :deep(.v-selection-control) {
  min-height: unset;
}

.app-bar {
  border-bottom-width: 2px;
}

/* stylelint-disable-next-line selector-class-pattern */
.error-snackbar :deep(.v-snackbar__wrapper) {
  border: var(--v-v2-snackbar-border);
}
</style>
