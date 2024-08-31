<script setup lang="ts">
import SIValueInput from '@/components/input/SIValueInput.vue';
import LogSlider from '@/components/input/LogSlider.vue';
import type { SIPrefixSymbol } from '@nanase/alnilam';

const {
  label,
  cols,
  sm,
  md,
  lg,
  xl,
  xxl,
  scale = 'linear',
  density,
  disabled,
  hideDetails,
  variant,
  max = 1,
  min = 0,
  constant = 0,
  step,
  fractionDigits = 0,
  menuIcon = 'mdi-dots-horizontal',
} = defineProps<{
  label?: string;
  cols?: string | number | boolean;
  sm?: string | number | boolean;
  md?: string | number | boolean;
  lg?: string | number | boolean;
  xl?: string | number | boolean;
  xxl?: string | number | boolean;
  scale?: 'linear' | 'log';
  variant?: 'underlined' | 'filled' | 'outlined' | 'plain' | 'solo' | 'solo-inverted' | 'solo-filled';
  density?: 'default' | 'comfortable' | 'compact';
  disabled?: boolean;
  hideDetails?: boolean;
  max?: number;
  min?: number;
  constant?: number;
  step?: number;
  fractionDigits?: number;
  unit?: string;
  prefixSymbols?: readonly SIPrefixSymbol[];
  rule?: ((value: any) => boolean | string)[];
  menuIcon?: string;
}>();

const value = defineModel<number>();
</script>

<template>
  <v-row>
    <v-col :cols :sm :md :lg :xl :xxl>
      <SIValueInput
        v-bind="$attrs"
        v-model:value="value"
        :unit
        :prefix-symbols
        :rule
        :label
        :density
        :variant
        :disabled
        :hideDetails
        :fractionDigits
      />
    </v-col>
    <v-col>
      <LogSlider v-if="scale === 'log'" v-model="value" :max :min :constant :density :disabled :hideDetails />
      <v-slider v-else v-model="value" :max :min :step :density :disabled :hideDetails>
        <template #thumb-label="{ modelValue }"> {{ Number(modelValue).toFixed(fractionDigits) }} </template>
      </v-slider>
    </v-col>
    <v-col cols="1" v-if="$slots['menu-list']">
      <v-menu>
        <template #activator="{ props }">
          <slot name="menu-button" :props>
            <v-btn v-bind="props" :icon="menuIcon" variant="plain" :density :disabled />
          </slot>
        </template>
        <v-list>
          <slot name="menu-list"></slot>
        </v-list>
      </v-menu>
    </v-col>
  </v-row>
</template>
