<script setup lang="ts">
import { ref, watch, onMounted, useAttrs } from 'vue';
import { SIValue, type SIPrefixSymbol } from '@nanase/alnilam/siPrefix';
import { Rules } from '@nanase/alnilam/inputRule';
import { VTextField } from 'vuetify/components';

const { unit, prefixSymbols, fractionDigits } = defineProps<{
  unit?: string;
  prefixSymbols?: readonly SIPrefixSymbol[];
  fractionDigits?: number;
  rule?: ((value: any) => boolean | string)[];
}>();
const attrs = useAttrs();
const actualValue = defineModel<number>('value');
const fraction = ref<string>();
const field = ref<VTextField>();

watch(
  () => actualValue.value,
  () => {
    updateFractionValue();
  },
);

onMounted(() => {
  updateFractionValue();
});

function updateFractionValue() {
  if (typeof actualValue.value !== 'undefined' && Number.isFinite(actualValue.value) && !field.value?.focused) {
    const siValue = SIValue.fit(actualValue.value, prefixSymbols ?? ['']);
    fraction.value = `${siValue.toFixed(fractionDigits ?? 3)}`;
  }
}

function fractionValueUpdated(value: string) {
  const decodedValue = SIValue.parse(value);

  if (Number.isFinite(decodedValue.fraction)) {
    actualValue.value = decodedValue.actualValue;
  }
}
</script>

<template>
  <v-text-field
    v-model:model-value="fraction"
    :rules="attrs.readonly ? [] : rule ? rule : [Rules.required, Rules.value, Rules.notZero, Rules.notNegative]"
    :prefix="unit"
    class="text-align-right"
    reverse
    inputmode="numeric"
    @update:model-value="fractionValueUpdated"
    ref="field"
  >
  </v-text-field>
</template>
