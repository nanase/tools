<script setup lang="ts">
import AppBaseV2 from '@/components/common/AppBaseV2.vue';
import { PageList } from '@/page';
import { useVuetifyTheme } from '@/lib/useVuetifyTheme';

const { pageId, title } = defineProps<{
  pageId?: string;
  title?: string;
}>();

const { isDark, toggle: toggleTheme } = useVuetifyTheme();
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

    <template #appbarAppend>
      <v-menu :close-on-content-click="false">
        <template v-slot:activator="{ props }">
          <v-btn icon v-bind="props" variant="plain" aria-label="ページオプションを表示">
            <v-icon>mdi-dots-horizontal</v-icon>
          </v-btn>
        </template>

        <v-list slim density="compact">
          <v-list-item @click="toggleTheme">
            <v-switch
              hide-details
              flat
              :ripple="false"
              v-model:model-value="isDark"
              aria-label="テーマを切り替え"
              true-icon="mdi-weather-night"
              false-icon="mdi-white-balance-sunny"
            >
              <template #prepend>テーマを切り替え</template>
            </v-switch>
          </v-list-item>

          <v-divider />

          <v-list-item class="px-1">
            <v-btn icon variant="plain" aria-label="GitHubのリポジトリに移動" href="https://github.com/nanase/tools/">
              <v-icon icon="fa:fab fa-github" />
            </v-btn>
          </v-list-item>
        </v-list>
      </v-menu>
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
