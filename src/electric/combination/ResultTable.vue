<script setup lang="ts">
import { ref } from 'vue';
import type { Combination } from '@/lib/passiveComponent';
import { SIValue } from '@/lib/siPrefix';
import { ternary } from '@/lib/object';

import type { ApproxResult } from './constants';

const { results } = defineProps<{
  results: ApproxResult[];
}>();
const resultTab = ref<string>();

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

function toTableHaders(result: ApproxResult) {
  return [
    {
      title: `${result.componentType.valueLabel} (${result.componentType.unit})`,
      value: 'value',
    },
    { title: '誤差率 (%)', value: 'error' },
    { title: '組み合わせ', value: 'combination' },
  ];
}

function combinationToTableItem(combinations: Combination[], result: ApproxResult) {
  return combinations.map((combination) => {
    const value = combination.calcValue(result.componentType.value);
    return {
      value: SIValue.fit(value, result.componentType.prefixSymbols).toSimpleString(3),
      isBestValue: value === result.bestComponentValue,
      error: errorRateToString(combination, result),
      combination: combination.toString(result.componentType.prefixSymbols),
    };
  });
}
</script>

<template>
  <v-tabs v-model="resultTab" align-tabs="center" bg-color="secondary">
    <v-tab
      v-for="result of results"
      :key="result.componentNumber"
      :prepend-icon="
        ternary(
          result.finished,
          result.finishReason === 'finishedAllCombination'
            ? 'mdi-check-all'
            : result.finishReason === 'aborted'
              ? 'mdi-progress-alert'
              : 'mdi-check',
          'mdi-timer-sand',
          'mdi-circle-medium',
        )
      "
    >
      {{ result.componentNumber }}本の解
    </v-tab>
  </v-tabs>
  <v-tabs-window v-model="resultTab">
    <v-tabs-window-item v-for="result of results" :key="result.componentNumber">
      <v-data-table
        :items="combinationToTableItem(result.resultCombinations ?? [], result)"
        :headers="toTableHaders(result)"
        density="compact"
        class="result-table"
        no-data-text="まだ計算されていません"
        items-per-page-text="ページごとの表示数:"
        page-text="全{2}個の結果 / {0}-{1}"
      >
        <template #item="{ item }">
          <tr :class="{ 'best-combination': item.isBestValue }">
            <td>{{ item.value }}</td>
            <td>{{ item.error }}</td>
            <td>{{ item.combination }}</td>
          </tr>
        </template>
      </v-data-table>
    </v-tabs-window-item>
  </v-tabs-window>
</template>

<style lang="scss">
.result-table tbody {
  tr.best-combination {
    font-weight: bold;
  }

  tr:not(.best-combination) {
    opacity: 0.4;
    transition-duration: 0.28s;
    transition-property: opacity;

    &:hover {
      opacity: 1;
    }
  }
}
</style>
