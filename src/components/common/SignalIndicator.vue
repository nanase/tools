<script setup lang="ts">
import { ref, watch } from 'vue';

const {
  disabled,
  max = 1,
  min = 0,
  value,

  strokeColor = '#0dab0d',
  fillColor = '#0dab0d',
  disabledColor = '#3a3a3a',
} = defineProps<{
  disabled?: boolean;
  max?: number;
  min?: number;
  value: number;

  strokeColor?: string;
  fillColor?: string;
  disabledColor?: string;
}>();

const lampStrokeColor = ref<string>(strokeColor);
const lampFillColor = ref<string>(fillColor);
const lampFillOpacity = ref<number>(0);
const lampFilter = ref<string>('none');

watch(
  () => [disabled, max, min, value],
  () => {
    lampStrokeColor.value = disabled ? disabledColor : strokeColor;
    lampFillColor.value = disabled ? disabledColor : fillColor;

    lampFillOpacity.value = Math.max(0, Math.min(1, (value - min) / (max - min)));
    lampFilter.value = `drop-shadow(0 0 ${lampFillOpacity.value * 10}px ${strokeColor})`;
  },
  { immediate: true },
);
</script>

<template>
  <svg class="signal-indicator" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle
      class="lamp"
      cx="50"
      cy="50"
      r="25"
      :style="{ stroke: lampStrokeColor, fill: lampFillColor, fillOpacity: lampFillOpacity, filter: lampFilter }"
    />
  </svg>
</template>

<style lang="scss">
.signal-indicator {
  min-height: 16px;

  .lamp {
    fill: transparent;
    fill-opacity: 0;
    stroke: #0dab0d;
    stroke-width: 10px;
    filter: drop-shadow(0 0 10px #0dab0d);
  }
}
</style>
