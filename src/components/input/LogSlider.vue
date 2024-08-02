<script setup lang="ts">
import { ref, watch } from 'vue';

const {
  max,
  min,
  resolution = 100,
} = defineProps<{
  max: number;
  min: number;
  resolution?: number;
}>();

const linearValue = defineModel<number>();
const logarithmicValue = ref<number>(0);
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
    v-model:model-value="logarithmicValue"
    @update:model-value="logarithmicValueUpdated"
    @start="movement = true"
    @end="movement = false"
    :max="Math.log(max) * resolution"
    :min="Math.log(min) * resolution"
  >
    <template #thumb-label>
      <slot name="thumb-label" :linearValue :logarithmicValue>
        {{ Number(linearValue).toFixed(3) }}
      </slot>
    </template>
  </v-slider>
</template>
