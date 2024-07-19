<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { SIValue, Rules, type SIPrefixSymbol } from '../../lib/siPrefix';
import { VTextField } from 'vuetify/components';

const { label, variant, density, placeholder, unit, prefixSymbols, readonly, fractionDigits } = defineProps<{
  label?: string;
  variant?: 'outlined' | 'plain' | 'filled' | 'underlined' | 'solo' | 'solo-inverted' | 'solo-filled' | undefined;
  density?: null | 'default' | 'comfortable' | 'compact';
  placeholder?: string;
  unit?: string;
  prefixSymbols?: readonly SIPrefixSymbol[];
  readonly?: boolean;
  fractionDigits?: number;
  rule?: ((value: any) => boolean | string)[];
}>();
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
    fraction.value = `${siValue.fraction.toFixed(fractionDigits ?? 3)}${siValue.prefix.symbol}`;
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
  <v-row no-gutters>
    <v-col>
      <v-text-field
        v-model:model-value="fraction"
        :label="label"
        :variant="variant"
        :density="density"
        :placeholder="placeholder"
        :rules="readonly ? [] : rule ? rule : [Rules.required, Rules.value, Rules.notZero, Rules.notNegative]"
        :readonly="readonly"
        :prefix="unit"
        class="text-align-right"
        reverse
        inputmode="numeric"
        @update:model-value="fractionValueUpdated"
        ref="field"
      >
      </v-text-field>
    </v-col>
  </v-row>
</template>
