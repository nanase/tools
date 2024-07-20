<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { Rules } from '@/lib/siPrefix';
import { useTheme } from 'vuetify';
import { reapplyTheme } from '@/lib/theme';
import {
  BiquadFilterCoefficients,
  type BiquadFilterParameter,
  type Coefficients,
} from '@/lib/biquadFilterCoefficients';

import AppBase from '@/components/common/AppBase.vue';
import SIValueInput from '@/components/input/SIValueInput.vue';

interface FilterType {
  title: string;
  value: string;
  requiredParameter: ('q' | 'bandwidth' | 'gain')[];
  func: (samplingRate: number, cutoff: number, parameter?: BiquadFilterParameter) => Coefficients;
}

const filterTypeItem: FilterType[] = [
  {
    title: 'ローパスフィルタ (LPF)',
    value: 'lowpass',
    requiredParameter: ['q'],
    func: BiquadFilterCoefficients.lowpass,
  },
  {
    title: 'ハイパスフィルタ (HPF)',
    value: 'highpass',
    requiredParameter: ['q'],
    func: BiquadFilterCoefficients.highpass,
  },
  {
    title: 'バンドパスフィルタ (BPF)',
    value: 'bandpass',
    requiredParameter: ['q', 'bandwidth'],
    func: BiquadFilterCoefficients.bandpass,
  },
  {
    title: 'バンドストップフィルタ (BSF)',
    value: 'bandstop',
    requiredParameter: ['bandwidth'],
    func: BiquadFilterCoefficients.bandstop,
  },
  {
    title: 'ローシェルフフィルタ (LSF)',
    value: 'lowshelf',
    requiredParameter: ['q', 'bandwidth', 'gain'],
    func: BiquadFilterCoefficients.lowshelf,
  },
  {
    title: 'ハイシェルフフィルタ (HSF)',
    value: 'highshelf',
    requiredParameter: ['q', 'bandwidth', 'gain'],
    func: BiquadFilterCoefficients.highshelf,
  },
  {
    title: 'ピーキングフィルタ (Peaking)',
    value: 'peaking',
    requiredParameter: ['bandwidth', 'gain'],
    func: BiquadFilterCoefficients.peaking,
  },
  {
    title: 'オールパスフィルタ (Allpass)',
    value: 'allpass',
    requiredParameter: ['q'],
    func: BiquadFilterCoefficients.allpass,
  },
];

const theme = useTheme();
const diagram = ref<HTMLObjectElement>();
const filterType = ref<FilterType>(filterTypeItem[0]);

const cutoffFreq = ref<number>(1000.0);
const q = ref<number>(0.707106781);
const bandwidth = ref<number>(1.0);
const gain = ref<number>(0.0);
const samplingFreq = ref<number>(48000.0);

function setTextContent(document: Document | null | undefined, id: string, text: string) {
  if (!document) {
    return;
  }

  const element = document.getElementById(id);

  if (element) {
    element.textContent = text;
  }
}

watch(
  () => [cutoffFreq.value, q.value, bandwidth.value, gain.value, samplingFreq.value],
  () => {
    const parameters: BiquadFilterParameter = {
      q: q.value,
      bandwidth: bandwidth.value,
      gain: gain.value,
    };
    const coefficients = filterType.value.func(samplingFreq.value, cutoffFreq.value, parameters);
    const normalized = coefficients.normalizeToFiveParameters();
    const diagram = window.document.querySelector('.diagram');

    if (!diagram) {
      return;
    }

    const diagramDom = (diagram as HTMLObjectElement).contentDocument;
    setTextContent(diagramDom, 'b0', normalized[0].toFixed(9));
    setTextContent(diagramDom, 'b1', normalized[1].toFixed(9));
    setTextContent(diagramDom, 'b2', normalized[2].toFixed(9));
    setTextContent(diagramDom, 'a1', normalized[3].toFixed(9));
    setTextContent(diagramDom, 'a2', normalized[4].toFixed(9));
  },
);

function onSVGLoaded() {
  reapplyTheme(theme);

  if (diagram.value) {
    diagram.value.style.opacity = '1';
  }
}
</script>

<template>
  <AppBase page-id="filter/biquad" toolbar-title="双2次フィルタ">
    <v-row>
      <v-col cols="12" md="7">
        <v-row>
          <v-col cols="12">
            <v-select
              label="フィルタタイプ"
              density="compact"
              variant="underlined"
              v-model="filterType"
              :items="filterTypeItem"
              hide-details
              return-object
            />
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="6" sm="4">
            <SIValueInput
              v-model:value="cutoffFreq"
              label="カットオフ周波数"
              variant="underlined"
              density="compact"
              unit="Hz"
              :fraction-digits="3"
              :prefix-symbols="['G', 'M', 'k', '']"
              :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
              hide-details
            />
          </v-col>
          <v-col cols="6" sm="8">
            <v-slider v-model="cutoffFreq" :max="samplingFreq / 2" :min="0.0" thumb-label hide-details>
              <template #thumb-label="{ modelValue }"> {{ Number(modelValue).toFixed(0) }} </template>
            </v-slider>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="6" sm="4">
            <SIValueInput
              v-model:value="q"
              label="Q"
              variant="underlined"
              density="compact"
              :fraction-digits="4"
              :rule="[Rules.required, Rules.value, Rules.notNegative]"
              hide-details
              :disabled="!filterType.requiredParameter.includes('q')"
            />
          </v-col>
          <v-col cols="6" sm="8">
            <v-slider
              v-model="q"
              :max="16.0"
              :min="0.0"
              :step="Math.SQRT1_2 / 8"
              thumb-label
              hide-details
              :disabled="!filterType.requiredParameter.includes('q')"
            >
              <template #thumb-label="{ modelValue }"> {{ Number(modelValue).toFixed(4) }} </template>
            </v-slider>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="6" sm="4">
            <SIValueInput
              v-model:value="bandwidth"
              label="帯域幅"
              variant="underlined"
              density="compact"
              unit="oct"
              :fraction-digits="3"
              :rule="[Rules.required, Rules.value, Rules.notNegative]"
              hide-details
              :disabled="!filterType.requiredParameter.includes('bandwidth')"
            />
          </v-col>
          <v-col cols="6" sm="8">
            <v-slider
              v-model="bandwidth"
              :max="12"
              :min="0.001"
              :step="0.1"
              thumb-label
              hide-details
              :disabled="!filterType.requiredParameter.includes('bandwidth')"
            >
              <template #thumb-label="{ modelValue }"> {{ Number(modelValue).toFixed(3) }} </template>
            </v-slider>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="6" sm="4">
            <SIValueInput
              v-model:value="gain"
              label="増幅量"
              variant="underlined"
              density="compact"
              unit="dB"
              :fraction-digits="2"
              :rule="[Rules.required, Rules.value]"
              hide-details
              :disabled="!filterType.requiredParameter.includes('gain')"
            />
          </v-col>
          <v-col cols="6" sm="8">
            <v-slider
              v-model="gain"
              :max="30"
              :min="-30"
              :step="0.1"
              thumb-label
              hide-details
              :disabled="!filterType.requiredParameter.includes('gain')"
            >
              <template #thumb-label="{ modelValue }"> {{ Number(modelValue).toFixed(2) }} </template>
            </v-slider>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="6" sm="4">
            <SIValueInput
              v-model:value="samplingFreq"
              label="サンプリング周波数"
              variant="underlined"
              density="compact"
              unit="Hz"
              :prefix-symbols="['G', 'M', 'k', '']"
              :fraction-digits="3"
              :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
              hide-details
            />
          </v-col>
          <v-col cols="6" sm="8">
            <v-slider v-model="samplingFreq" :max="192000" :min="0.0" :step="1" thumb-label hide-details>
              <template #thumb-label="{ modelValue }"> {{ Number(modelValue).toFixed(0) }} </template>
            </v-slider>
          </v-col>
        </v-row>
      </v-col>
      <v-col cols="12" md="5" class="text-center">
        <object
          ref="diagram"
          class="diagram color-responsive"
          type="image/svg+xml"
          data="/tools/filter/biquad.svg"
          @load="onSVGLoaded"
        ></object>
      </v-col>
    </v-row>
  </AppBase>
</template>

<style lang="scss" scoped>
.diagram {
  width: 100%;
  max-width: 400px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
</style>
