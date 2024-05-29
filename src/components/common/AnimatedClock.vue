<script setup lang="ts">
import { Dayjs } from '@/lib/dayjs';

const { time } = defineProps<{
  time: Dayjs;
}>();
</script>

<template>
  <div class="animated-clock">
    <span class="date">{{ time.format('YYYY-MM-DD') }}</span>
    <span class="time">
      <span>{{ time.format('HH') }}</span>
      <span :style="`visibility:${time.millisecond() < 666 ? 'visible' : 'hidden'}`">:</span>
      <span>{{ time.format('mm') }}</span>
      <span :style="`visibility:${time.millisecond() < 666 ? 'visible' : 'hidden'}`">:</span>
      <span>{{ time.format('ss') }}</span>
    </span>
  </div>
</template>

<style lang="scss">
.animated-clock {
  .date {
    padding-right: 0.5rem;
  }

  .time {
    font-size: 100%;
  }
}
</style>
