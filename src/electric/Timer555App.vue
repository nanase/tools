<script setup lang="ts">
import { ref, watch } from 'vue';
import { Rules } from '@/lib/siPrefix';

import AppBase from '../components/common/AppBase.vue';
import SIValueInput from '../components/input/SIValueInput.vue';
import MathJax from '../components/common/MathJax.vue';
import InputRow from '@/components/input/InputRow.vue';

const r1Value = ref<number>(10e3);
const r2Value = ref<number>(10e3);
const c1Value = ref<number>(0.1e-6);
const vccValue = ref<number>(5);
const freqValue = ref<number>();
const hTimeValue = ref<number>();
const lTimeValue = ref<number>();
const dutyRatioValue = ref<number>();
const r1MaxCurrentValue = ref<number>();
const r1MaxPowerValue = ref<number>();

// function encodeSIValue(value: number): { fraction: string; exponent: string } {
//   if (value >= 1000.0) {
//     return { fraction: (value / 1000.0).toFixed(3), exponent: 'k' };
//   }

//   return { fraction: value.toFixed(3), exponent: '' };
// }

watch(
  () => [r1Value.value, r2Value.value, c1Value.value],
  () => {
    const r1 = r1Value.value;
    const r2 = r2Value.value;
    const c1 = c1Value.value;

    if (
      typeof r1 !== 'undefined' &&
      typeof r2 !== 'undefined' &&
      typeof c1 !== 'undefined' &&
      Number.isFinite(r1) &&
      Number.isFinite(r2) &&
      Number.isFinite(c1)
    ) {
      freqValue.value = Math.LOG2E / ((r1 + r2 * 2) * c1);
      hTimeValue.value = (1 / Math.LOG2E) * ((r1 + r2) * c1);
      lTimeValue.value = (1 / Math.LOG2E) * (r2 * c1);
      dutyRatioValue.value = ((r1 + r2) / (r1 + 2 * r2)) * 100;
    }
  },
  { immediate: true },
);

watch(
  () => [vccValue.value, r1Value.value],
  () => {
    const vcc = vccValue.value;
    const r1 = r1Value.value;

    if (typeof vcc !== 'undefined' && typeof r1 !== 'undefined' && Number.isFinite(vcc) && Number.isFinite(r1)) {
      r1MaxCurrentValue.value = vcc / r1;
      r1MaxPowerValue.value = vcc ** 2 / r1;
    }
  },
  { immediate: true },
);
</script>

<template>
  <AppBase page-id="electric/timer555" toolbar-title="タイマIC 555 計算機">
    <v-row>
      <v-col cols="12" sm="8">
        <InputRow
          v-model="r1Value"
          label="R1の抵抗値"
          variant="underlined"
          density="compact"
          unit="Ω"
          scale="log"
          :max="1e6"
          :min="100"
          :fraction-digits="3"
          :prefix-symbols="['M', 'k', '', 'm']"
          :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
          cols="4"
          hide-details
        >
          <template #menu-list>
            <v-list-item title="100.0 kΩ" @click="r1Value = 100.0e3" />
            <v-list-item title="47.0 kΩ" @click="r1Value = 47.0e3" />
            <v-list-item title="10.0 kΩ" @click="r1Value = 10.0e3" />
            <v-list-item title="4.7 kΩ" @click="r1Value = 4.7e3" />
            <v-list-item title="1.0 kΩ" @click="r1Value = 1.0e3" />
            <v-list-item title="470 Ω" @click="r1Value = 470.0" />
          </template>
        </InputRow>

        <InputRow
          v-model="r2Value"
          label="R2の抵抗値"
          variant="underlined"
          density="compact"
          unit="Ω"
          scale="log"
          :max="1e6"
          :min="100"
          :fraction-digits="3"
          :prefix-symbols="['M', 'k', '', 'm']"
          :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
          cols="4"
          hide-details
        >
          <template #menu-list>
            <v-list-item title="100.0 kΩ" @click="r2Value = 100.0e3" />
            <v-list-item title="47.0 kΩ" @click="r2Value = 47.0e3" />
            <v-list-item title="10.0 kΩ" @click="r2Value = 10.0e3" />
            <v-list-item title="4.7 kΩ" @click="r2Value = 4.7e3" />
            <v-list-item title="1.0 kΩ" @click="r2Value = 1.0e3" />
            <v-list-item title="470 Ω" @click="r2Value = 470.0" />
          </template>
        </InputRow>

        <InputRow
          v-model="c1Value"
          label="C1の静電容量"
          variant="underlined"
          density="compact"
          unit="F"
          scale="log"
          :max="1e-3"
          :min="1e-12"
          :fraction-digits="3"
          :prefix-symbols="['', 'm', 'μ', 'n', 'p']"
          :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
          cols="4"
          hide-details
        >
          <template #menu-list>
            <v-list-item title="100.0 μF" @click="c1Value = 100.0e-6" />
            <v-list-item title="10.0 μF" @click="c1Value = 10.0e-6" />
            <v-list-item title="1.0 μF" @click="c1Value = 1.0e-6" />
            <v-list-item title="0.1 μF" @click="c1Value = 0.1e-6" />
            <v-list-item title="0.01 μF" @click="c1Value = 0.01e-6" />
            <v-list-item title="0.001 μF" @click="c1Value = 0.001e-6" />
          </template>
        </InputRow>

        <InputRow
          v-model="vccValue"
          label="電源電圧"
          variant="underlined"
          density="compact"
          unit="V"
          :max="18"
          :min="1"
          scale="log"
          :fraction-digits="2"
          :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
          cols="4"
          hide-details
        >
          <template #menu-list>
            <v-list-item title="18 V" @click="vccValue = 18" />
            <v-list-item title="9 V" @click="vccValue = 9" />
            <v-list-item title="5 V" @click="vccValue = 5" />
            <v-list-item title="3.3 V" @click="vccValue = 3.3" />
            <v-list-item title="1.8 V" @click="vccValue = 1.8" />
          </template>
        </InputRow>

        <v-row>
          <v-col cols="3">
            <SIValueInput
              v-model:value="freqValue"
              label="周波数"
              variant="underlined"
              density="compact"
              unit="Hz"
              :prefix-symbols="['G', 'M', 'k', '']"
              readonly
            />
          </v-col>
          <v-col cols="3">
            <SIValueInput
              v-model:value="hTimeValue"
              label="Hレベル時間"
              variant="underlined"
              density="compact"
              unit="s"
              :prefix-symbols="['', 'm', 'μ', 'n']"
              readonly
            />
          </v-col>
          <v-col cols="3">
            <SIValueInput
              v-model:value="lTimeValue"
              label="Lレベル時間"
              variant="underlined"
              density="compact"
              unit="s"
              :prefix-symbols="['', 'm', 'μ', 'n']"
              readonly
            />
          </v-col>
          <v-col cols="3">
            <SIValueInput
              v-model:value="dutyRatioValue"
              label="デューティ比"
              variant="underlined"
              density="compact"
              unit="%"
              readonly
            />
          </v-col>
          <v-col cols="3">
            <SIValueInput
              v-model:value="r1MaxCurrentValue"
              label="R1の最大電流"
              variant="underlined"
              density="compact"
              readonly
              unit="A"
              :prefix-symbols="['', 'm', 'μ', 'n']"
            />
          </v-col>
          <v-col cols="3">
            <SIValueInput
              v-model:value="r1MaxPowerValue"
              label="R1の最大損失"
              variant="underlined"
              density="compact"
              readonly
              unit="W"
              :prefix-symbols="['', 'm', 'μ', 'n']"
            />
          </v-col>
        </v-row>
      </v-col>
      <v-col cols="12" sm="4" class="text-center">
        <img class="color-responsive" src="/electric/timer555.svg" style="width: 100%; max-width: 400px" />
      </v-col>
    </v-row>
    <v-row>
      <v-col cols="12">
        <MathJax>
          <p>
            出力パルスのHレベルの時間 \(t_\text{high}\) とLレベルの時間 \( t_\text{low} \)
            はそれぞれ以下の式で求められます。
          </p>
          <p>$$ t_\text{high} = \ln(2) \cdot (R_{1}+R_{2})\cdot C_1 $$</p>
          <p>$$ t_\text{low} = \ln(2) \cdot R_2 \cdot C_1 $$</p>
          <p>したがって、出力パルスの周波数 \(f\) は次の式で求められます。</p>
          <p>$$ f = \frac{1}{t_\text{high} + t_\text{low}} = \frac{1}{\ln(2) \cdot (R_1 + 2 R_2) \cdot C_1} $$</p>
          <p>さらに、デューティ比 \(D\) は次の式で求められます。</p>
          <p>
            $$ D~(\%) = \frac{t_\text{high}}{t_\text{high} + t_\text{low}} \cdot 100 = \frac{R_1 + R_2}{R_1 + 2 R_2}
            \cdot 100 $$
          </p>
          <p>
            ここで \(t\) は時間 [s]、\(R\) は抵抗値 [Ω]、\(C\) は静電容量 [F]、\(f\) は周波数 [Hz]、\(\ln(2)\)
            は2の自然対数です。
          </p>
        </MathJax>
      </v-col>
    </v-row>
  </AppBase>
</template>
