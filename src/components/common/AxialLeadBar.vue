<script setup lang="ts">
const { color, luster = false } = defineProps<{
  color: string;
  luster?: boolean;
}>();
</script>

<template>
  <div class="axial-lead-bar" :class="{ luster }"></div>
</template>

<style lang="scss">
.axial-lead-bar {
  min-width: 1px;
  min-height: 10px;
  height: 100%;
  background: v-bind(color);

  &.luster {
    background: linear-gradient(
      0deg,
      v-bind(color) 0%,
      color-mix(in hsl shorter hue, v-bind(color), #ffff 80%) 66%,
      v-bind(color) 100%
    );
  }
}
</style>
