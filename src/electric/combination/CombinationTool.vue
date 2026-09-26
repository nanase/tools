<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue';
import { useWebWorker, type UseWebWorkerReturn } from '@vueuse/core';
import { SIValue } from '@nanase/alnilam/siPrefix';
import { Rules } from '@nanase/alnilam/inputRule';
import { ESeries, Combination } from '@/lib/passiveComponent';
import { DialogRoot, DialogPortal, DialogContent, DialogOverlay, DialogClose } from 'radix-vue';

import SIValueInput from '@/components/input/SIValueInput.vue';
import ResultTable from './ResultTable.vue';

import approximateWorker from './worker?worker';
import type { InitializeParameter, InvokeParameter, WorkerResult } from './workerType';
import {
  componentTypeItem,
  initialInputProps,
  seriesItem,
  targetErrorRateItems,
  type ApproxResult,
  type ComponentTypeItem,
  type SeriesItem,
  type TargetErrorRateItem,
} from './constants';

const approxResults = ref<(ApproxResult & { worker: UseWebWorkerReturn<WorkerResult> })[]>(
  [2, 3, 4, 5].map((num) => ({
    componentNumber: num,
    componentType: componentTypeItem[0],
    targetComponentValue: 1234,
    series: ESeries[seriesItem[3].value],
    minValue: 0,
    maxValue: 0,
    excludedValues: [],
    targetErrorRate: targetErrorRateItems[2],
    worker: useWebWorker<WorkerResult>(new approximateWorker()),
  })),
);
const componentType = ref<ComponentTypeItem>(componentTypeItem[0]);
const inputProps = ref(initialInputProps);
const currentInputProps = computed(() => inputProps.value[componentType.value.value]);
const series = ref<SeriesItem>(seriesItem[3]);
const targetErrorRate = ref<TargetErrorRateItem>(targetErrorRateItems[2]);
const startedApprox = computed<boolean>(() => approxResults.value.some((r) => r.finishReason === 'calculating'));
const abortApprox = ref<boolean>();
const additionalExcludedValue = ref<number>(1000);
const excludedDialogOpen = ref(false);
const approxProgress = computed<number>(() => {
  if (!startedApprox.value) {
    return 0;
  }

  const total = approxResults.value.reduce((prev, current) => prev + (current.totalCombinations ?? 0), 0);
  const current = approxResults.value.reduce((prev, current) => prev + (current.currentCombination ?? 0), 0);

  return total === 0 ? 0 : (current / total) * 100;
});

const statusMessage = computed<string>(() => {
  if (startedApprox.value) return `計算中... ${approxProgress.value.toFixed(3)}%`;
  if (approxResults.value.some((r) => r.finishReason === 'aborted')) return '計算を中止しました';
  if (approxResults.value.some((r) => r.finishReason === 'error')) return 'エラーにより計算を中止しました';
  if (approxResults.value.some((r) => r.finishReason === 'finishedByUnderErrorRate')) return '計算が完了しました';
  if (approxResults.value.every((r) => r.finishReason === 'finishedAllCombination')) return '全探索が完了しました';
  return '';
});

for (const approxResult of approxResults.value) {
  watch(
    () => approxResult.worker.data,
    (result) => {
      if (result.result) {
        const r = result.result;
        ({ current: approxResult.currentCombination, total: approxResult.totalCombinations } = r);

        if (r.componentNodes) {
          const combination = new Combination(toRaw(r.componentNodes));

          if (!approxResult.resultCombinations?.some((a) => a.equals(combination))) {
            approxResult.resultCombinations?.unshift(combination);

            approxResult.bestComponentValue = combination.calcValue(approxResult.componentType.value);
            const errorRate =
              (approxResult.bestComponentValue - approxResult.targetComponentValue) / approxResult.targetComponentValue;

            if (
              typeof approxResult.targetErrorRate.value === 'number' &&
              Math.abs(errorRate) <= approxResult.targetErrorRate.value
            ) {
              approxResult.finishReason = 'finishedByUnderErrorRate';
              approxResult.finished = true;
              return;
            }
          }
        }
      }

      if (result.done) {
        approxResult.finishReason = 'finishedAllCombination';
        approxResult.finished = true;
        return;
      }

      if (abortApprox.value) {
        approxResult.finishReason = 'aborted';
        approxResult.finished = true;
      } else {
        approxResult.worker.post({ type: 'invoke' } as const satisfies InvokeParameter);
      }
    },
  );
}

function addExcludedValue() {
  if (
    [Rules.required, Rules.value, Rules.notNegative, Rules.notZero].every(
      (r) => r(additionalExcludedValue.value.toString()) === true,
    ) &&
    !currentInputProps.value.excludedValues.includes(additionalExcludedValue.value)
  ) {
    currentInputProps.value.excludedValues.push(additionalExcludedValue.value);
  }
}

function removeExcludedValue(value: number) {
  currentInputProps.value.excludedValues = currentInputProps.value.excludedValues.filter((v) => v !== value);
}

function onClickStartApprox() {
  if (startedApprox.value) {
    abortApprox.value = true;
  } else {
    abortApprox.value = false;

    for (const approx of approxResults.value) {
      approx.componentType = componentType.value;
      approx.targetComponentValue = currentInputProps.value.componentTargetValue;
      approx.minValue = currentInputProps.value.minValue;
      approx.maxValue = currentInputProps.value.maxValue;
      approx.excludedValues = currentInputProps.value.excludedValues;
      approx.series = ESeries[series.value.value];
      approx.targetErrorRate = targetErrorRate.value;
      approx.finished = false;
      approx.finishReason = 'calculating';
      approx.bestComponentValue = 0;
      approx.resultCombinations = [];
      approx.totalCombinations = 0;
      approx.currentCombination = 0;

      approx.worker.post({
        type: 'initialize',
        value: approx.targetComponentValue,
        componentType: approx.componentType.value,
        componentNumber: approx.componentNumber,
        series: [...approx.series],
        minValue: approx.minValue,
        maxValue: approx.maxValue,
        excludedValues: [...approx.excludedValues],
        progressBeacon: 1e6,
      } as const satisfies InitializeParameter);
      approx.worker.post({ type: 'invoke' } as const satisfies InvokeParameter);
    }
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Row 1: Component type + Target value -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr]">
      <div class="flex flex-col gap-0.5">
        <label class="text-xs text-[var(--color-on-background)] opacity-60">素子の種類</label>
        <select
          class="border-b border-[var(--color-on-background)]/30 bg-transparent py-1 text-sm outline-none focus:border-[var(--color-primary)]"
          :value="componentTypeItem.indexOf(componentType)"
          @change="componentType = componentTypeItem[Number(($event.target as HTMLSelectElement).value)]"
        >
          <option v-for="(item, index) in componentTypeItem" :key="item.value" :value="index">
            {{ item.title }}
          </option>
        </select>
      </div>
      <SIValueInput
        v-model:value="currentInputProps.componentTargetValue"
        :label="`求める${componentType.valueLabel}`"
        :unit="componentType.unit"
        :fraction-digits="3"
        :prefix-symbols="componentType.prefixSymbols"
        :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
      />
    </div>

    <!-- Row 2: E-series + Excluded values -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr]">
      <div class="flex flex-col gap-0.5">
        <label class="text-xs text-[var(--color-on-background)] opacity-60">E系列</label>
        <select
          class="border-b border-[var(--color-on-background)]/30 bg-transparent py-1 text-sm outline-none focus:border-[var(--color-primary)]"
          :value="seriesItem.indexOf(series)"
          @change="series = seriesItem[Number(($event.target as HTMLSelectElement).value)]"
        >
          <option v-for="(item, index) in seriesItem" :key="item.value" :value="index">
            {{ item.title }}
          </option>
        </select>
      </div>
      <div class="flex flex-col gap-0.5">
        <label class="text-xs text-[var(--color-on-background)] opacity-60">
          除外する{{ componentType.valueLabel }}（オプション）
        </label>
        <button
          class="flex items-center gap-1 border-b border-[var(--color-on-background)]/30 py-1 text-left text-sm transition-colors hover:border-[var(--color-primary)]"
          @click="excludedDialogOpen = true"
        >
          <span v-if="currentInputProps.excludedValues.length === 0" class="flex-1 opacity-40">
            クリックして設定
          </span>
          <span v-else class="flex flex-1 flex-wrap gap-1">
            <span
              v-for="v in currentInputProps.excludedValues"
              :key="v"
              class="rounded bg-[var(--color-on-background)]/10 px-1.5 py-0.5 text-xs"
            >
              {{ SIValue.fit(v, componentType.prefixSymbols) }}{{ componentType.unit }}
            </span>
          </span>
          <span class="mdi mdi-pencil text-sm opacity-40" />
        </button>

        <!-- Excluded values dialog -->
        <DialogRoot v-model:open="excludedDialogOpen">
          <DialogPortal>
            <DialogOverlay class="fixed inset-0 z-40 bg-black/30" />
            <DialogContent
              class="fixed top-1/2 left-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-[var(--color-surface)] p-6 shadow-xl focus:outline-none"
            >
              <h3 class="text-lg font-semibold">除外する{{ componentType.valueLabel }}</h3>
              <p class="mt-2 text-sm opacity-70">
                目標の{{ componentType.valueLabel }}以外にも、組み合わせに使用しない{{
                  componentType.valueLabel
                }}を複数指定できます。
              </p>

              <form class="mt-4" @submit.prevent="addExcludedValue">
                <div class="grid grid-cols-[1fr_auto_auto] items-end gap-2">
                  <SIValueInput
                    v-model:value="additionalExcludedValue"
                    :label="`除外の対象に追加する${componentType.valueLabel}`"
                    :unit="componentType.unit"
                    :fraction-digits="3"
                    :prefix-symbols="componentType.prefixSymbols"
                    :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
                  />
                  <button
                    type="submit"
                    class="rounded border border-green-600 px-3 py-1 text-sm text-green-600 transition-colors hover:bg-green-600/10"
                  >
                    追加
                  </button>
                  <button
                    type="button"
                    class="rounded border border-[var(--color-on-background)]/30 px-3 py-1 text-sm transition-colors hover:bg-[var(--color-on-background)]/10"
                    @click="currentInputProps.excludedValues = []"
                  >
                    全てクリア
                  </button>
                </div>
              </form>

              <ul v-if="currentInputProps.excludedValues.length > 0" class="mt-3 divide-y divide-[var(--color-on-background)]/10">
                <li
                  v-for="value in currentInputProps.excludedValues"
                  :key="value"
                  class="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm transition-colors hover:bg-[var(--color-on-background)]/5"
                  @click="removeExcludedValue(value)"
                >
                  <span class="mdi mdi-close text-base opacity-50" />
                  {{ SIValue.fit(value, componentType.prefixSymbols) }}{{ componentType.unit }}
                </li>
              </ul>
              <p v-else class="mt-3 py-2 text-center text-sm opacity-40">除外する値はありません</p>

              <div class="mt-4 flex justify-end">
                <DialogClose as-child>
                  <button class="rounded px-4 py-1.5 text-sm transition-colors hover:bg-[var(--color-on-background)]/10">
                    閉じる
                  </button>
                </DialogClose>
              </div>
            </DialogContent>
          </DialogPortal>
        </DialogRoot>
      </div>
    </div>

    <!-- Row 3: Min/Max values + Target error rate -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <SIValueInput
        v-model:value="currentInputProps.minValue"
        :label="`使用する最小の${componentType.valueLabel}`"
        :unit="componentType.unit"
        :fraction-digits="0"
        :prefix-symbols="componentType.prefixSymbols"
        :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
      />
      <SIValueInput
        v-model:value="currentInputProps.maxValue"
        :label="`使用する最大の${componentType.valueLabel}`"
        :unit="componentType.unit"
        :fraction-digits="0"
        :prefix-symbols="componentType.prefixSymbols"
        :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
      />
      <div class="flex flex-col gap-0.5">
        <label class="text-xs text-[var(--color-on-background)] opacity-60">計算を終える誤差率</label>
        <select
          class="border-b border-[var(--color-on-background)]/30 bg-transparent py-1 text-sm outline-none focus:border-[var(--color-primary)]"
          :value="targetErrorRateItems.indexOf(targetErrorRate)"
          @change="targetErrorRate = targetErrorRateItems[Number(($event.target as HTMLSelectElement).value)]"
        >
          <option v-for="(item, index) in targetErrorRateItems" :key="index" :value="index">
            {{ item.title }}
          </option>
        </select>
      </div>
    </div>

    <!-- Row 4: Progress bar + Start button -->
    <div class="grid grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_auto]">
      <div class="relative h-6 overflow-hidden rounded bg-[var(--color-on-background)]/10">
        <div
          class="absolute inset-y-0 left-0 transition-all duration-300"
          :class="startedApprox ? 'bg-sky-500 animate-pulse' : 'bg-sky-600'"
          :style="{ width: `${approxProgress}%` }"
        />
        <div class="absolute inset-0 flex items-center justify-center text-xs font-bold">
          {{ statusMessage }}
        </div>
      </div>
      <button
        class="flex items-center justify-center gap-2 rounded px-6 py-2 text-sm font-semibold transition-colors"
        :class="
          startedApprox
            ? 'border border-red-500 text-red-500 hover:bg-red-500/10'
            : 'bg-green-600 text-white hover:bg-green-700'
        "
        @click="onClickStartApprox"
      >
        <span :class="`mdi ${startedApprox ? 'mdi-timer-sand' : 'mdi-play'}`" />
        <span v-if="startedApprox" class="flex flex-col leading-tight">
          <span>計算中</span>
          <span class="text-xs font-normal opacity-70">クリックで中止</span>
        </span>
        <span v-else>計算開始</span>
      </button>
    </div>

    <!-- Row 5: Results -->
    <ResultTable :results="approxResults" />
  </div>
</template>
