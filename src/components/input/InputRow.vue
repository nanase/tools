<script setup lang="ts">
import { ref, computed } from 'vue';
import SIValueInput from '@/components/input/SIValueInput.vue';
import LogSlider from '@/components/input/LogSlider.vue';
import { SliderRoot, SliderTrack, SliderRange, SliderThumb } from 'radix-vue';
import { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent } from 'radix-vue';
import type { SIPrefixSymbol } from '@nanase/alnilam/siPrefix';

const {
  label,
  scale = 'linear',
  disabled,
  max = 1,
  min = 0,
  constant = 0,
  step,
  fractionDigits = 0,
} = defineProps<{
  label?: string;
  scale?: 'linear' | 'log';
  disabled?: boolean;
  max?: number;
  min?: number;
  constant?: number;
  step?: number;
  fractionDigits?: number;
  unit?: string;
  prefixSymbols?: readonly SIPrefixSymbol[];
  rule?: ((value: string) => boolean | string)[];
}>();

defineSlots<{
  'menu-list'?: (props: Record<string, never>) => unknown;
}>();

const value = defineModel<number>();
const hasMenu = ref(false);

const linearSliderValue = computed<number[]>({
  get: () => [value.value ?? min],
  set: (v: number[]) => {
    value.value = v[0];
  },
});
</script>

<template>
  <div class="grid items-center gap-x-3 gap-y-1" :class="$slots['menu-list'] ? 'grid-cols-[1fr_1fr_auto]' : 'grid-cols-2'">
    <div>
      <SIValueInput
        v-model:value="value"
        :unit
        :prefix-symbols="prefixSymbols"
        :rule
        :label
        :disabled
        :fraction-digits="fractionDigits"
      />
    </div>
    <div class="flex items-center self-end pb-1.5">
      <LogSlider v-if="scale === 'log'" v-model="value" :max :min :constant :disabled />
      <SliderRoot
        v-else
        v-model="linearSliderValue"
        :max
        :min
        :step
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
    </div>
    <div v-if="$slots['menu-list']" class="flex items-center self-end pb-1">
      <DropdownMenuRoot>
        <DropdownMenuTrigger as-child>
          <button
            class="flex items-center justify-center rounded-lg p-1.5 transition-colors hover:bg-[var(--color-on-background)]/10"
            :disabled
            aria-label="プリセット値"
          >
            <span class="mdi mdi-dots-horizontal text-lg" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            class="z-50 min-w-[140px] rounded-lg border border-[var(--color-on-background)]/10 bg-[var(--color-surface)] py-1 shadow-lg"
            :side-offset="4"
            align="end"
          >
            <slot name="menu-list" />
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </div>
  </div>
</template>
