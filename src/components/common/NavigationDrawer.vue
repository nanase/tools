<script setup lang="ts">
import { defineModel } from 'vue';

const { pageId } = defineProps<{
  pageId: string;
}>();

const opened = defineModel<boolean>('opened');
</script>

<template>
  <v-navigation-drawer v-model="opened" floating aria-label="サイトページ一覧" class="bg-primary">
    <v-list class="pb-0 d-flex flex-column fill-height" role="menu">
      <v-list-item
        :active="pageId === 'electric/timer555'"
        link
        title="タイマIC 555 計算機"
        href="/tools/electric/timer555"
        role="menuitem"
      >
        <template v-slot:prepend>
          <v-icon icon="mdi-chip" size="large" />
        </template>
      </v-list-item>

      <v-divider />

      <v-list-item
        :active="pageId === 'jjy/simulator'"
        link
        title="JJY シミュレータ"
        href="/tools/jjy/simulator"
        role="menuitem"
      >
        <template v-slot:prepend>
          <v-icon icon="mdi-alarm" size="large" />
        </template>
      </v-list-item>
    </v-list>
  </v-navigation-drawer>
</template>
