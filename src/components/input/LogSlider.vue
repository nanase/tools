<script setup lang="ts">
import { ref, watch } from 'vue';
import { SliderRoot, SliderTrack, SliderRange, SliderThumb } from 'radix-vue';

const {
  max,
  min,
  step,
  constant = 0,
  disabled,
} = defineProps<{
  max: number;
  min: number;
  step?: number;
  constant?: number;
  disabled?: boolean;
}>();

const linearValue = defineModel<number>();
const logarithmicValue = ref<number[]>([0]);
const moving = ref(false);

watch(
  () => linearValue.value,
  () => {
    if (linearValue.value && !moving.value) {
      logarithmicValue.value = [Math.log(linearValue.value + constant)];
    }
  },
  { immediate: true },
);

function logarithmicValueUpdated(value: number[] | undefined) {
  if (!value) return;
  logarithmicValue.value = value;
  linearValue.value = Math.exp(value[0]) - constant;
}

function onSlideStart() {
  moving.value = true;
}

function onSlideEnd() {
  moving.value = false;
}
</script>

<template>
  <SliderRoot
    :model-value="logarithmicValue"
    @update:model-value="logarithmicValueUpdated"
    @pointerdown="onSlideStart"
    @pointerup="onSlideEnd"
    :max="Math.log(max)"
    :min="Math.log(min)"
    :step="typeof step !== 'undefined' ? Math.log(step) : 0.01"
    :disabled
    class="relative flex w-full touch-none items-center select-none"
    :class="disabled ? 'opacity-50' : ''"
  >
    <SliderTrack class="relative h-1 w-full grow rounded-full bg-[var(--color-on-background)]/15">
      <SliderRange class="absolute h-full rounded-full bg-[var(--color-primary)]" />
    </SliderTrack>
    <SliderThumb
      class="block size-4 rounded-full bg-[var(--color-primary)] shadow transition-colors hover:bg-[var(--color-primary)]/80 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50"
    />
  </SliderRoot>
</template>
