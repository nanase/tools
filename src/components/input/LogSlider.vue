<script setup lang="ts">
import { ref, watch } from 'vue';
import type { VSlider } from 'vuetify/components';

const {
  variant,
  density,
  disabled,
  readonly,
  max,
  min,
  resolution = 100,
  thumbLabel,
  hideDetails,
} = defineProps<{
  max: number;
  min: number;
  resolution?: number;
  variant?: 'outlined' | 'plain' | 'filled' | 'underlined' | 'solo' | 'solo-inverted' | 'solo-filled' | undefined;
  density?: null | 'default' | 'comfortable' | 'compact';
  disabled?: boolean;
  readonly?: boolean;
  thumbLabel?: boolean | 'always';
  hideDetails?: boolean | 'auto';
}>();

const linearValue = defineModel<number>();
const logarithmicValue = ref<number>(0);
const slider = ref<typeof VSlider>();
const movement = ref<boolean>();

watch(
  () => linearValue.value,
  () => {
    if (linearValue.value && !movement.value) {
      logarithmicValue.value = Math.log(linearValue.value) * resolution;
    }
  },
  { immediate: true },
);

function logarithmicValueUpdated() {
  linearValue.value = Math.exp(logarithmicValue.value / resolution);
}
</script>

<template>
  <v-slider
    ref="slider"
    v-model:model-value="logarithmicValue"
    @update:model-value="logarithmicValueUpdated"
    @start="movement = true"
    @end="movement = false"
    :max="Math.log(max) * resolution"
    :min="Math.log(min) * resolution"
    :variant
    :density
    :readonly
    :disabled
    :hide-details
    :thumb-label
  >
    <template #thumb-label> {{ Number(linearValue).toFixed(3) }} </template>
  </v-slider>
</template>
