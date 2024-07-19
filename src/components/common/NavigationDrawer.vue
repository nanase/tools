<script setup lang="ts">
import { PageList } from '@/page';

const { pageId } = defineProps<{
  pageId: string;
}>();

const opened = defineModel<boolean>('opened');
</script>

<template>
  <v-navigation-drawer v-model="opened" floating aria-label="サイトページ一覧" class="bg-primary">
    <v-list class="pb-0 d-flex flex-column fill-height" role="menu">
      <template v-for="(section, index) in PageList" :key="section.id">
        <v-divider v-if="index > 0" />

        <v-list-item
          v-for="page in section.pages"
          :key="page.id"
          :active="pageId === page.id"
          link
          :title="page.title"
          :href="page.path ?? `/tools/${page.id}`"
          role="menuitem"
        >
          <template #prepend v-if="page.icon">
            <v-icon :icon="page.icon" size="large" />
          </template>
        </v-list-item>
      </template>
    </v-list>
  </v-navigation-drawer>
</template>
