<script setup lang="ts">
import AppBaseV2 from '@/components/common/AppBaseV2.vue';
import { PageList } from '@/page';

const { pageId, title } = defineProps<{
  pageId?: string;
  title?: string;
}>();
</script>

<template>
  <AppBaseV2 :title :pageId>
    <template #drawerMenu="{ currentPage }">
      <v-list-item
        class="py-2"
        link
        title=""
        href="/tools/"
        role="menuitem"
        density="default"
        base-color="v2DrawerList"
      >
        <v-list-item-title style="font-size: 110%" class="font-weight-bold">Tools + Simulators</v-list-item-title>
      </v-list-item>
      <v-divider class="mx-4" />

      <v-list class="flex-grow-1 flex-shrink-1 overflow-auto" role="menu" density="compact">
        <template v-for="(section, index) in PageList" :key="section.id">
          <v-divider v-if="index > 0" class="mx-4 py-2" />
          <v-list-item class="py-0" :min-height="32">
            <v-list-item-title class="text-overline">{{ section.name }}</v-list-item-title>
          </v-list-item>
          <v-list role="menu" class="py-0 pb-5" density="compact">
            <v-list-item
              class="py-0"
              v-for="page in section.pages"
              :key="page.id"
              link
              slim
              :active="currentPage?.id === page.id"
              color="v2DrawerListActive"
              base-color="v2DrawerList"
              :title="page.menuTitle ?? page.title"
              :href="page.path ?? `/tools/${page.id}`"
              role="menuitem"
              :min-height="32"
            >
              <template #prepend v-if="page.icon"><v-icon :icon="page.icon" size="small" /></template>
            </v-list-item>
          </v-list>
        </template>
      </v-list>
    </template>

    <template #header>
      <slot name="header"></slot>
    </template>

    <slot></slot>

    <template #footer>
      <slot name="footer"></slot>
    </template>
  </AppBaseV2>
</template>
