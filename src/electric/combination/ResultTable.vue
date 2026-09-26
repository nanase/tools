<script setup lang="ts">
import { ref } from 'vue';
import type { Combination } from '@/lib/passiveComponent';
import { SIValue } from '@nanase/alnilam/siPrefix';

import type { ApproxResult } from './constants';
import CombinationDialog from './CombinationDialog.vue';

const { results } = defineProps<{
  results: ApproxResult[];
}>();
const activeTab = ref(0);

function errorRateToString(combination: Combination, result: ApproxResult): string {
  const value = combination.calcValue(result.componentType.value);

  if (value === result.targetComponentValue) {
    return '= 正確';
  }

  const errorRate = ((value - result.targetComponentValue) / result.targetComponentValue) * 100;

  if (Math.abs(errorRate) < 0.001) {
    return errorRate > 0 ? '< +0.001' : '< -0.001';
  } else {
    return (errorRate > 0 ? '+' : '') + errorRate.toFixed(3);
  }
}

function getStatusIcon(result: ApproxResult): string {
  if (result.finished) {
    if (result.finishReason === 'finishedAllCombination') return 'mdi-check-all';
    if (result.finishReason === 'aborted') return 'mdi-progress-alert';
    return 'mdi-check';
  }
  if (result.finishReason === 'calculating') return 'mdi-timer-sand';
  return 'mdi-circle-medium';
}

function combinationToTableItem(combinations: Combination[], result: ApproxResult) {
  return combinations.map((combination) => {
    const value = combination.calcValue(result.componentType.value);
    return {
      value: SIValue.fit(value, result.componentType.prefixSymbols).toSimpleString(3),
      isBestValue: value === result.bestComponentValue,
      error: errorRateToString(combination, result),
      combinationText: combination.toString(result.componentType.prefixSymbols),
      numberOfTypes: combination.numberOfTypes,
      combination,
    };
  });
}
</script>

<template>
  <div>
    <!-- Tabs -->
    <div class="flex border-b border-[var(--color-on-background)]/10">
      <button
        v-for="(result, index) in results"
        :key="result.componentNumber"
        class="flex items-center gap-1.5 px-4 py-2 text-sm transition-colors"
        :class="
          activeTab === index
            ? 'border-b-2 border-[var(--color-primary)] font-semibold'
            : 'opacity-60 hover:opacity-100'
        "
        @click="activeTab = index"
      >
        <span :class="`mdi ${getStatusIcon(result)} text-base`" />
        {{ result.componentNumber }}本の解
      </button>
    </div>

    <!-- Tab Content -->
    <div v-for="(result, index) in results" :key="result.componentNumber" v-show="activeTab === index">
      <div v-if="!result.resultCombinations?.length" class="py-8 text-center text-sm opacity-50">
        まだ計算されていません
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--color-on-background)]/10 text-left">
              <th class="px-3 py-2">{{ result.componentType.valueLabel }} ({{ result.componentType.unit }})</th>
              <th class="px-3 py-2">誤差率 (%)</th>
              <th class="px-3 py-2">組み合わせ</th>
              <th class="px-3 py-2">素子の種類数</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="item in combinationToTableItem(result.resultCombinations ?? [], result)" :key="item.combinationText">
              <CombinationDialog :combination="item.combination" :result>
                <template #activator="{ props: activatorProps }">
                  <tr
                    v-bind="activatorProps"
                    class="cursor-pointer border-b border-[var(--color-on-background)]/5 transition-opacity hover:bg-[var(--color-on-background)]/5"
                    :class="item.isBestValue ? 'font-bold' : 'opacity-40 hover:opacity-100'"
                  >
                    <td class="px-3 py-1.5">{{ item.value }}</td>
                    <td class="px-3 py-1.5">{{ item.error }}</td>
                    <td class="px-3 py-1.5">{{ item.combinationText }}</td>
                    <td class="px-3 py-1.5">{{ item.numberOfTypes }}</td>
                  </tr>
                </template>
              </CombinationDialog>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
