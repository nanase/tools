<script setup lang="ts">
import AppBase from '@/components/common/AppBase.vue';
import { PageList } from '@/page';
</script>

<template>
  <AppBase page-id="index" toolbar-title="Tools + Simulator">
    <v-list class="pb-0 d-flex flex-column fill-height" role="menu">
      <template v-for="(section, index) in PageList" :key="section.id">
        <v-list-subheader>{{ section.name }}</v-list-subheader>
        <v-list-item
          v-for="page in section.pages"
          :key="page.id"
          link
          :title="page.title"
          :subtitle="page.description"
          :href="page.path ?? `/tools/${page.id}`"
          role="menuitem"
        >
          <template #prepend v-if="page.icon">
            <v-icon :icon="page.icon" size="large" />
          </template>
        </v-list-item>
        <div class="mb-5"></div>
      </template>
    </v-list>
  </AppBase>
</template>
