<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { SIValue, type SIPrefixSymbol } from '@nanase/alnilam/siPrefix';
import { Rules } from '@nanase/alnilam/inputRule';

const {
  label,
  unit,
  prefixSymbols,
  fractionDigits,
  rule,
  disabled,
  readonly: isReadonly,
} = defineProps<{
  label?: string;
  unit?: string;
  prefixSymbols?: readonly SIPrefixSymbol[];
  fractionDigits?: number;
  rule?: ((value: string) => boolean | string)[];
  disabled?: boolean;
  readonly?: boolean;
}>();

const actualValue = defineModel<number>('value');
const fraction = ref<string>('');
const focused = ref(false);
const errorMessage = ref<string>('');

const activeRules = isReadonly ? [] : rule ? rule : [Rules.required, Rules.value, Rules.notZero, Rules.notNegative];

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
  if (typeof actualValue.value !== 'undefined' && Number.isFinite(actualValue.value) && !focused.value) {
    const siValue = SIValue.fit(actualValue.value, prefixSymbols ?? ['']);
    fraction.value = `${siValue.toFixed(fractionDigits ?? 3)}`;
  }
}

function fractionValueUpdated(value: string) {
  fraction.value = value;
  const decodedValue = SIValue.parse(value);

  if (Number.isFinite(decodedValue.fraction)) {
    actualValue.value = decodedValue.actualValue;
  }

  validate(value);
}

function validate(value: string) {
  for (const r of activeRules) {
    const result = r(value);
    if (result !== true) {
      errorMessage.value = result;
      return;
    }
  }
  errorMessage.value = '';
}

function onFocus() {
  focused.value = true;
}

function onBlur() {
  focused.value = false;
  updateFractionValue();
}
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <label v-if="label" class="text-xs text-[var(--color-on-background)] opacity-60">{{ label }}</label>
    <div
      class="flex items-center gap-1 border-b transition-colors"
      :class="
        errorMessage
          ? 'border-[var(--color-negative)]'
          : focused
            ? 'border-[var(--color-primary)]'
            : 'border-[var(--color-on-background)]/30'
      "
    >
      <input
        type="text"
        inputmode="numeric"
        class="min-w-0 flex-1 bg-transparent py-1 text-right text-sm outline-none"
        :class="disabled ? 'opacity-50' : ''"
        :value="fraction"
        :disabled
        :readonly="isReadonly"
        @input="fractionValueUpdated(($event.target as HTMLInputElement).value)"
        @focus="onFocus"
        @blur="onBlur"
      />
      <span v-if="unit" class="shrink-0 text-xs opacity-60">{{ unit }}</span>
    </div>
    <span v-if="errorMessage" class="text-xs text-[var(--color-negative)]">{{ errorMessage }}</span>
  </div>
</template>
