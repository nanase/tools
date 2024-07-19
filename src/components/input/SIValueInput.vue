<script setup lang="ts">
import { ref, watch } from 'vue';
import { SIValue, type SIPrefixSymbol } from '../../lib/siPrefix';

const { label, variant, density, placeholder, unit, prefixSymbols, readonly } = defineProps<{
  label?: string;
  variant?: 'outlined' | 'plain' | 'filled' | 'underlined' | 'solo' | 'solo-inverted' | 'solo-filled' | undefined;
  density?: null | 'default' | 'comfortable' | 'compact';
  placeholder?: string;
  unit?: string;
  prefixSymbols?: readonly SIPrefixSymbol[];
  readonly?: boolean;
}>();
const actualValue = defineModel<number>('value');
const fraction = ref<string>();

const rules = {
  required: (value: string) => !!value || '値を入力してください',
  value: (value: string) => Number.isFinite(SIValue.parse(value).fraction) || '不正な値です',
  notZero: (value: string) => Number(value) !== 0 || '値を 0 にはできません',
  notNegative: (value: string) => {
    const siValue = SIValue.parse(value);
    return (Number.isFinite(siValue.fraction) && siValue.fraction >= 0) || '負値にはできません';
  },
};

watch(
  () => actualValue.value,
  () => {
    if (typeof actualValue.value !== 'undefined' && Number.isFinite(actualValue.value) && readonly) {
      const siValue = SIValue.fit(actualValue.value, prefixSymbols ?? ['']);
      fraction.value = `${siValue.fraction.toFixed(3)}${siValue.prefix.symbol}`;
    }
  },
);

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
        :rules="readonly ? [] : [rules.required, rules.value, rules.notZero, rules.notNegative]"
        :readonly="readonly"
        :prefix="unit"
        class="text-align-right"
        reverse
        inputmode="numeric"
        @update:model-value="fractionValueUpdated"
      >
      </v-text-field>
    </v-col>
  </v-row>
</template>
