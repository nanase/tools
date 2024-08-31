<script setup lang="ts">
import { ref, markRaw, onBeforeUnmount } from 'vue';
import Chart from 'chart.js/auto';

import { type State } from '@nanase/alnilam';

const { initializer } = defineProps<{
  initializer: (canvas: HTMLCanvasElement) => Chart;
}>();

const canvas = ref<HTMLCanvasElement>();
const chart = ref<Chart>();

function initialize() {
  if (!canvas.value || !(canvas.value instanceof HTMLCanvasElement)) {
    console.warn('There is no canvas element for Chart. Did you place it?');
    return;
  }

  chart.value = markRaw(initializer(canvas.value));
}

onBeforeUnmount(() => {
  if (chart.value) {
    chart.value.destroy();
  }
});

defineExpose({
  getChart: function (): State<Chart, 'chart'> {
    if (!chart.value) {
      initialize();
    }

    if (!chart.value) {
      return {
        ready: false,
        chart: null,
      };
    }

    return {
      ready: true,
      chart: chart.value,
    };
  },
});
</script>

<template>
  <canvas ref="canvas"></canvas>
</template>
