<script setup lang="ts">
import type { ColorCode } from '@/lib/passiveComponent';
import AxialLeadBar from './AxialLeadBar.vue';

const {
  text = '',
  color = 'white',
  colorCodes,
  barsAlign = 'center',
  barWidth = 8,
  separatorWidth = 4,
} = defineProps<{
  text?: string;
  color?: string;
  colorCodes?: ColorCode[];
  barsAlign?: 'center' | 'left' | 'right';
  barWidth?: number;
  separatorWidth?: number;
}>();
</script>

<template>
  <div class="axial-lead">
    <div class="label">
      {{ text }}
    </div>
    <div class="bar-container" :style="{ justifyContent: barsAlign }">
      <AxialLeadBar
        v-for="(colorCode, index) of colorCodes"
        :key="index"
        :color="colorCode.color.hex"
        :luster="colorCode.color.luster"
        :style="{ width: barWidth + 'px', margin: `0 ${separatorWidth}px` }"
      />
    </div>
  </div>
</template>

<style lang="scss">
.axial-lead {
  position: relative;
  min-width: 10px;
  min-height: 10px;
  padding: 0 10px;
  background-color: v-bind(color);
  border: solid 1px;
  border-color: color-mix(in hsl shorter hue, v-bind(color), #00000040 50%);
  border-radius: 10px / 20px;
  margin: 5px;
  box-shadow:
    inset color-mix(in hsl shorter hue, v-bind(color), #ffff 50%) 5px 5px 10px 0,
    inset color-mix(in hsl shorter hue, v-bind(color), #00000040 50%) -5px -5px 10px 0;

  .label {
    position: absolute;
    align-items: center;
    display: flex;
    height: 100%;
    width: 100%;
  }

  .bar-container {
    display: flex;
    height: 100%;
    width: 100%;
  }
}
</style>
