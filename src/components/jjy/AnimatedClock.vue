<script setup lang="ts">
import { computed } from 'vue';
import { format } from 'date-fns';

const { time } = defineProps<{
  time: Date;
}>();

const dateStr = computed(() => format(time, 'yyyy/MM/dd (EEE)'));
const timeStr = computed(() => format(time, 'HH:mm:ss'));
</script>

<template>
  <div class="font-mono">
    <div class="text-sm opacity-60">{{ dateStr }}</div>
    <div class="text-2xl font-bold tabular-nums">{{ timeStr }}</div>
  </div>
</template>
