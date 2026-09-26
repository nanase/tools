<script setup lang="ts">
import { ref, computed } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { DialogRoot, DialogPortal, DialogContent, DialogOverlay } from 'radix-vue';
import { PageList, type PageSection, type Page } from '@/page';
import { useTheme } from '@/composables/useTheme';

const { title, pageId } = defineProps<{
  title?: string;
  pageId?: string;
}>();

const { isDark, toggle: toggleTheme } = useTheme();

const drawerOpen = ref(false);
const mdAndDown = useMediaQuery('(max-width: 959.98px)');
const smAndDown = useMediaQuery('(max-width: 599.98px)');

const currentSection = computed<PageSection | undefined>(() =>
  PageList.find((section) => section.pages.some((page) => page.id === pageId)),
);

const currentPage = computed<Page | undefined>(() =>
  currentSection.value?.pages.find((page) => page.id === pageId),
);

const displayTitle = computed(() => title ?? currentPage.value?.title ?? '');
const displayIcon = computed(() => currentPage.value?.icon);

function openDrawer() {
  drawerOpen.value = true;
}
</script>

<template>
  <!-- Navigation Drawer -->
  <DialogRoot v-model:open="drawerOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/30" />
      <DialogContent
        class="fixed inset-y-0 left-0 z-50 flex w-[270px] flex-col bg-[var(--color-drawer-background)] shadow-xl focus:outline-none"
      >
        <!-- Drawer Header -->
        <a
          href="/tools/"
          class="flex items-center px-4 py-3 text-[var(--color-drawer-list)] no-underline transition-colors hover:bg-black/5"
        >
          <span class="font-semibold">Tools + Simulators</span>
        </a>
        <div class="mx-4 border-t border-[var(--color-drawer-list)]/10" />

        <!-- Page List -->
        <nav class="flex-1 overflow-y-auto">
          <template v-for="(section, index) in PageList" :key="section.id">
            <div v-if="index > 0" class="mx-4 border-t border-[var(--color-drawer-list)]/10 my-2" />
            <div class="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-drawer-list)] opacity-60">
              {{ section.name }}
            </div>
            <ul class="m-0 list-none p-0 pb-2">
              <li v-for="page in section.pages" :key="page.id">
                <a
                  :href="`/tools/${page.id}`"
                  class="flex items-center gap-2 px-4 py-1.5 text-sm no-underline transition-colors"
                  :class="
                    currentPage?.id === page.id
                      ? 'text-[var(--color-drawer-list-active)] font-semibold bg-[var(--color-drawer-list-active)]/10'
                      : 'text-[var(--color-drawer-list)] hover:bg-black/5'
                  "
                >
                  <span v-if="page.icon" :class="`mdi ${page.icon} text-base`" />
                  <span>{{ page.menuTitle ?? page.title }}</span>
                </a>
              </li>
            </ul>
          </template>
        </nav>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <!-- App Bar -->
  <header
    class="sticky top-0 z-30 border-b border-[var(--color-on-background)]/10 bg-[var(--color-app-bar-background)]"
  >
    <div class="flex items-center justify-between" :class="smAndDown ? 'h-12 px-2' : 'h-14 px-4'">
      <div class="flex items-center gap-2">
        <button
          class="flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-[var(--color-on-background)]/10"
          @click="openDrawer"
          aria-label="メニューを開く"
        >
          <span v-if="displayIcon" :class="`mdi ${displayIcon} text-xl`" />
          <span v-else class="mdi mdi-menu text-xl" />
        </button>
        <h1 class="text-base font-semibold" :class="smAndDown ? 'text-sm' : ''">
          {{ displayTitle }}
        </h1>
      </div>

      <div class="flex items-center gap-1">
        <!-- Theme Toggle -->
        <button
          class="flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-[var(--color-on-background)]/10"
          @click="toggleTheme"
          :aria-label="isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'"
        >
          <span :class="isDark ? 'mdi mdi-weather-night text-lg' : 'mdi mdi-white-balance-sunny text-lg'" />
        </button>

        <!-- GitHub Link -->
        <a
          href="https://github.com/nanase/tools/"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center justify-center rounded-lg p-2 text-[var(--color-on-background)] transition-colors hover:bg-[var(--color-on-background)]/10"
          aria-label="GitHub"
        >
          <span class="mdi mdi-github text-lg" />
        </a>
      </div>
    </div>

    <!-- Sub App Bar (mobile menu link) -->
    <div v-if="mdAndDown" class="flex items-center border-t border-[var(--color-on-background)]/5 px-2">
      <button
        class="flex items-center gap-2 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-[var(--color-on-background)]/10"
        @click="openDrawer"
      >
        <span class="mdi mdi-menu text-sm" />
        <span>Menu</span>
      </button>
    </div>
  </header>

  <!-- Main Content -->
  <main class="mx-auto max-w-7xl px-4 pb-16 pt-4">
    <slot />
  </main>
</template>
