<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue';
import { useWebWorker, type UseWebWorkerReturn } from '@vueuse/core';
import { SIValue } from '@nanase/alnilam/siPrefix';
import { Rules } from '@nanase/alnilam/inputRule';
import { ESeries, Combination } from '@/lib/passiveComponent';

import ToolAppBase from '@/components/common/ToolAppBase.vue';
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
const approxProgress = computed<number>(() => {
  if (!startedApprox.value) {
    return 0;
  }

  const total = approxResults.value.reduce((prev, current) => prev + (current.totalCombinations ?? 0), 0);
  const current = approxResults.value.reduce((prev, current) => prev + (current.currentCombination ?? 0), 0);

  return total === 0 ? 0 : (current / total) * 100;
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
  <ToolAppBase page-id="electric/combination" toolbar-title="受動素子 組み合わせ計算機">
    <v-row>
      <v-col cols="4">
        <v-select
          label="素子の種類"
          density="compact"
          variant="underlined"
          v-model="componentType"
          :items="componentTypeItem"
          hide-details
          return-object
        />
      </v-col>
      <v-col cols="8">
        <SIValueInput
          v-model:value="currentInputProps.componentTargetValue"
          :label="`求める${componentType.valueLabel}`"
          variant="underlined"
          density="compact"
          :unit="componentType.unit"
          :fraction-digits="3"
          :prefix-symbols="componentType.prefixSymbols"
          :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
          hide-details
        />
      </v-col>
    </v-row>
    <v-row>
      <v-col cols="4">
        <v-select
          label="E系列"
          density="compact"
          variant="underlined"
          v-model="series"
          :items="seriesItem"
          hide-details
          return-object
        />
      </v-col>
      <v-col cols="8">
        <v-dialog max-width="600">
          <template #activator="{ props: activatorProps }">
            <v-combobox
              v-bind="activatorProps"
              multiple
              :model-value="currentInputProps.excludedValues"
              :label="`除外する${componentType.valueLabel}（オプション）`"
              :suffix="componentType.unit"
              density="compact"
              variant="underlined"
              hide-details
              readonly
            ></v-combobox>
          </template>
          <template #default="{ isActive }">
            <v-card :title="`除外する${componentType.valueLabel}`">
              <v-card-text>
                目標の{{ componentType.valueLabel }}以外にも、組み合わせに使用しない{{
                  componentType.valueLabel
                }}を複数指定できます。
              </v-card-text>
              <v-card-text>
                <v-form @submit.prevent="addExcludedValue">
                  <v-row>
                    <v-col>
                      <SIValueInput
                        v-model:value="additionalExcludedValue"
                        :label="`除外の対象に追加する${componentType.valueLabel}`"
                        variant="underlined"
                        density="compact"
                        :unit="componentType.unit"
                        :fraction-digits="3"
                        :prefix-symbols="componentType.prefixSymbols"
                        :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
                        hide-details
                      />
                    </v-col>
                    <v-col cols="3">
                      <v-btn color="success" type="submit" variant="outlined" block>追加</v-btn>
                    </v-col>
                    <v-col cols="3">
                      <v-btn variant="outlined" block @click="currentInputProps.excludedValues = []">
                        全てクリア
                      </v-btn>
                    </v-col>
                  </v-row>
                </v-form>
                <v-list
                  density="compact"
                  @click:select="
                    (param) =>
                      (currentInputProps.excludedValues = currentInputProps.excludedValues.filter(
                        (v) => v !== param.id,
                      ))
                  "
                >
                  <v-list-item v-for="(value, key) in currentInputProps.excludedValues" :key :value slim>
                    {{ SIValue.fit(value, componentType.prefixSymbols) }}{{ componentType.unit }}
                    <template #prepend>
                      <v-icon icon="mdi-close" />
                    </template>
                  </v-list-item>
                </v-list>
              </v-card-text>

              <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn text="閉じる" @click="isActive.value = false"></v-btn>
              </v-card-actions>
            </v-card>
          </template>
        </v-dialog>
      </v-col>
    </v-row>
    <v-row>
      <v-col cols="4">
        <SIValueInput
          v-model:value="currentInputProps.minValue"
          :label="`使用する最小の${componentType.valueLabel}`"
          variant="underlined"
          density="compact"
          :unit="componentType.unit"
          :fraction-digits="0"
          :prefix-symbols="componentType.prefixSymbols"
          :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
          hide-details
        />
      </v-col>
      <v-col cols="4">
        <SIValueInput
          v-model:value="currentInputProps.maxValue"
          :label="`使用する最大の${componentType.valueLabel}`"
          variant="underlined"
          density="compact"
          :unit="componentType.unit"
          :fraction-digits="0"
          :prefix-symbols="componentType.prefixSymbols"
          :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
          hide-details
        />
      </v-col>
      <v-col cols="4">
        <v-select
          label="計算を終える誤差率"
          density="compact"
          variant="underlined"
          v-model="targetErrorRate"
          :items="targetErrorRateItems"
          hide-details
          return-object
        />
      </v-col>
    </v-row>
    <v-row>
      <v-col align-self="center">
        <v-progress-linear color="light-blue" v-model="approxProgress" height="20" :striped="startedApprox">
          <strong v-if="startedApprox">計算中... {{ approxProgress.toFixed(3) }}%</strong>
          <strong v-else-if="approxResults.some((r) => r.finishReason === 'aborted')">計算を中止しました</strong>
          <strong v-else-if="approxResults.some((r) => r.finishReason === 'error')">
            エラーにより計算を中止しました
          </strong>
          <strong v-else-if="approxResults.some((r) => r.finishReason === 'finishedByUnderErrorRate')">
            計算が完了しました
          </strong>
          <strong v-else-if="approxResults.every((r) => r.finishReason === 'finishedAllCombination')">
            全探索が完了しました
          </strong>
        </v-progress-linear>
      </v-col>
      <v-col cols="4">
        <v-btn
          :prepend-icon="startedApprox ? 'mdi-timer-sand' : 'mdi-play'"
          :variant="startedApprox ? 'outlined' : 'flat'"
          :color="startedApprox ? 'error' : 'success'"
          @click="onClickStartApprox"
          block
        >
          <template #default v-if="startedApprox">
            <div>計算中</div>
            <div class="text-caption">クリックで中止</div>
          </template>
          <template #default v-else>計算開始</template>
        </v-btn>
      </v-col>
    </v-row>
    <v-row>
      <v-col>
        <ResultTable :results="approxResults" />
      </v-col>
    </v-row>
  </ToolAppBase>
</template>
