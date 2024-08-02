<script setup lang="ts">
import { ref, watch } from 'vue';

const { max, min } = defineProps<{
  max: number;
  min: number;
}>();

const linearValue = defineModel<number>();
const logarithmicValue = ref<number>(0);
const moving = ref<boolean>(false);

watch(
  () => linearValue.value,
  () => {
    if (linearValue.value && !moving.value) {
      logarithmicValue.value = Math.log(linearValue.value);
    }
  },
  { immediate: true },
);

function logarithmicValueUpdated() {
  linearValue.value = Math.exp(logarithmicValue.value);
}
</script>

<template>
  <v-slider
    v-model:model-value="logarithmicValue"
    @update:model-value="logarithmicValueUpdated"
    @start="moving = true"
    @end="moving = false"
    :max="Math.log(max)"
    :min="Math.log(min)"
  >
    <template #thumb-label>
      <slot name="thumb-label" :linearValue :logarithmicValue>
        {{ Number(linearValue).toFixed(3) }}
      </slot>
    </template>
  </v-slider>
</template>
