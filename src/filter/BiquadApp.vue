<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Rules } from '@/lib/siPrefix';
import { useTheme } from 'vuetify';
import { reapplyTheme } from '@/lib/theme';
import { BiquadFilter } from '@/lib/filter/biquadFilter';
import Chart from 'chart.js/auto';
import annotationPlugin from 'chartjs-plugin-annotation';
import * as Tone from 'tone';
import MathJax from '@/components/common/MathJax.vue';

import AppBase from '@/components/common/AppBase.vue';
import SIValueInput from '@/components/input/SIValueInput.vue';
import ChartBase from '@/components/common/ChartBase.vue';
import LogSlider from '@/components/input/LogSlider.vue';

import {
  type FilterType,
  filterTypeItem,
  chartOptions,
  impulseChartOptions,
  cutoffAnnotationOptions,
} from './biquadAppConfig';
import { divide, findMinMax, sequence } from '@/lib/array';
import { deepAssign, RawObject } from '@/lib/object';

Chart.register(annotationPlugin);

const theme = useTheme();
const diagram = ref<HTMLObjectElement>();
const filterType = ref<FilterType>(filterTypeItem[0]);
const chart = ref<InstanceType<typeof ChartBase>>();
const impulseChart = ref<InstanceType<typeof ChartBase>>();
const chartMinimumMagnitude = ref<number>(-60.0);

const cutoffFreq = ref<number>(1000.0);
const q = ref<number>(0.707106781);
const gain = ref<number>(6.0);
const samplingFreq = ref<number>(48000.0);

const impulseLength = ref<number>(1024);
const impulseGraphLength = ref<number>(1024 / 4);
const biquadFilter = computed<BiquadFilter>(() => new BiquadFilter(impulseLength.value));
const coefficients = ref<number[]>([1, 0, 0, 0, 0, 0]);
const normalizedCoefficients = ref<number[]>([1, 0, 0, 0, 0]);
const magnitudeOnCutoff = ref<number>(0);
const maxMagnitude = ref<number>(0);
const minMagnitude = ref<number>(0);
const maxMagnitudeFrequency = ref<number>(0);
const minMagnitudeFrequency = ref<number>(0);
const sumImpulse = ref<number>(0);
const graphXLabel = computed<number[]>(() => divide(samplingFreq.value / 2, impulseLength.value / 2));

const soundPlaying = ref<boolean>();
const soundVolume = ref<number>(-30);
let synth: Tone.Noise | null = null;
let toneFilter: Tone.BiquadFilter | null = null;

function updateDiagram() {
  function setTextContent(document: Document | null | undefined, id: string, text: string) {
    deepAssign(document?.getElementById(id), { textContent: text });
  }

  const diagram = window.document.querySelector<HTMLObjectElement>('.diagram');

  if (diagram) {
    const diagramDom = diagram.contentDocument;
    setTextContent(diagramDom, 'b0', biquadFilter.value.normalizedCoefficients[0].toFixed(9));
    setTextContent(diagramDom, 'b1', biquadFilter.value.normalizedCoefficients[1].toFixed(9));
    setTextContent(diagramDom, 'b2', biquadFilter.value.normalizedCoefficients[2].toFixed(9));
    setTextContent(diagramDom, 'a1', biquadFilter.value.normalizedCoefficients[3].toFixed(9));
    setTextContent(diagramDom, 'a2', biquadFilter.value.normalizedCoefficients[4].toFixed(9));
  }
}

function updateGraph() {
  const chartState = chart.value?.getChart();

  if (!chartState || !chartState.ready) {
    return;
  }

  function segmentedPhaseResponse() {
    const data: { x: number; y: number }[] = [];
    let prevValue = biquadFilter.value.phaseResponse[0];

    for (let i = 1; i < impulseLength.value; i++) {
      const currentValue = biquadFilter.value.phaseResponse[i];

      if (Math.abs(currentValue - prevValue) >= 180.0 && i < impulseLength.value - 1) {
        data.push({ x: (graphXLabel.value[i] + graphXLabel.value[i + 1]) / 2, y: Number.NaN });
      }

      data.push({ x: graphXLabel.value[i], y: currentValue });
      prevValue = currentValue;
    }

    return data;
  }

  deepAssign(chartState.chart.options.plugins?.annotation?.annotations, {
    cutoffFreqLine: new RawObject(
      Object.assign(
        {
          xMax: cutoffFreq.value,
          xMin: cutoffFreq.value,
        },
        cutoffAnnotationOptions,
      ),
    ),
  });

  deepAssign(chartState.chart, {
    data: {
      datasets: [
        {
          label: '振幅 (dB)',
          data: biquadFilter.value.frequencyResponse,
          pointStyle: false,
          yAxisID: 'y',
          hidden:
            typeof chartState.chart.data.datasets[0]?.hidden === 'undefined'
              ? false
              : !chartState.chart.isDatasetVisible(0),
        },
        {
          label: '位相 (deg)',
          data: segmentedPhaseResponse(),
          pointStyle: false,
          yAxisID: 'y1',
          hidden:
            typeof chartState.chart.data.datasets[1]?.hidden === 'undefined'
              ? false
              : !chartState.chart.isDatasetVisible(1),
        },
      ],
      labels: graphXLabel.value,
    },
    scales: {
      x: {
        options: {
          max: samplingFreq.value / 2,
          min: 200 / 2 ** (Math.log2(impulseLength.value) - 8),
        },
      },
      y: {
        options: {
          max: Math.round(Math.max(findMinMax(biquadFilter.value.frequencyResponse).max, 0) + 10),
          min: chartMinimumMagnitude.value,
        },
      },
    },
  }).update('none');
}

function updateImpulseGraph() {
  const chartState = impulseChart.value?.getChart();

  if (!chartState || !chartState.ready) {
    return;
  }

  deepAssign(chartState.chart, {
    data: {
      datasets: [
        {
          label: 'インパルス応答',
          data: biquadFilter.value.impluseResponse.slice(0, impulseGraphLength.value),
          pointStyle: 'rect',
          borderWidth: 0,
          backgroundColor: 'rgb(54, 162, 235)',
          barPercentage: 1.2,
          hidden:
            typeof chartState.chart.data.datasets[0]?.hidden === 'undefined'
              ? false
              : !chartState.chart.isDatasetVisible(0),
        },
      ],
      labels: sequence(impulseGraphLength.value),
    },
  }).update('none');
}

function updateFilterCoefficients() {
  biquadFilter.value.setFilter(filterType.value.value, samplingFreq.value, cutoffFreq.value, {
    q: q.value,
    gain: gain.value,
  });
  coefficients.value = [...biquadFilter.value.coefficients];
  normalizedCoefficients.value = [...biquadFilter.value.normalizedCoefficients];

  biquadFilter.value.transform();
  magnitudeOnCutoff.value =
    (biquadFilter.value.frequencyResponse[Math.floor((cutoffFreq.value / samplingFreq.value) * impulseLength.value)] +
      biquadFilter.value.frequencyResponse[
        Math.floor((cutoffFreq.value / samplingFreq.value) * impulseLength.value + 1)
      ]) /
    2;

  const minMax = findMinMax(biquadFilter.value.frequencyResponse);
  maxMagnitude.value = minMax.max;
  minMagnitude.value = minMax.min;
  maxMagnitudeFrequency.value = (samplingFreq.value / impulseLength.value) * minMax.maxIndex;
  minMagnitudeFrequency.value = (samplingFreq.value / impulseLength.value) * minMax.minIndex;
  sumImpulse.value = biquadFilter.value.impluseResponse.reduce((p, c) => p + c, 0.0);

  updateDiagram();
  updateGraph();
  updateImpulseGraph();
}

watch(
  () => [impulseLength.value, filterType.value, cutoffFreq.value, q.value, gain.value, samplingFreq.value],
  () => {
    if (impulseGraphLength.value > impulseLength.value) {
      impulseGraphLength.value = impulseLength.value;
    }

    updateFilterCoefficients();

    if (toneFilter) {
      toneFilter.set({
        frequency: cutoffFreq.value,
        Q: q.value,
        gain: gain.value,
        type: filterType.value.toneFilterType,
      });
    }
  },
);

watch(() => chartMinimumMagnitude.value, updateGraph);
watch(() => impulseGraphLength.value, updateImpulseGraph);

function onSVGLoaded() {
  reapplyTheme(theme);
  updateFilterCoefficients();

  if (diagram.value) {
    diagram.value.style.opacity = '1';
  }
}

function initializeChart(canvas: HTMLCanvasElement): Chart {
  return new Chart(canvas, chartOptions);
}

function initializeImpulseChart(canvas: HTMLCanvasElement): Chart {
  return new Chart(canvas, impulseChartOptions);
}

async function clickSoundPlaying() {
  if (soundPlaying.value) {
    synth?.stop();
  } else {
    if (synth == null) {
      await Tone.start();

      toneFilter = new Tone.BiquadFilter({
        frequency: cutoffFreq.value,
        Q: q.value,
        gain: gain.value,
      }).toDestination();

      synth = new Tone.Noise().connect(toneFilter);
    }

    synth.volume.value = soundVolume.value;
    synth.start();
  }
}

watch(
  () => soundVolume.value,
  () => {
    if (synth) {
      synth.volume.value = soundVolume.value;
    }
  },
);
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
          <v-col cols="4">
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
          <v-col cols="7">
            <LogSlider v-model="cutoffFreq" :max="samplingFreq / 2" :min="10" thumb-label hide-details />
          </v-col>
          <v-col cols="1">
            <v-menu>
              <template v-slot:activator="{ props }">
                <v-btn icon="mdi-dots-horizontal" v-bind="props" variant="plain" density="compact" />
              </template>
              <v-list>
                <v-list-item title="10 kHz" @click="cutoffFreq = 10.0e3" />
                <v-list-item title="1 kHz" @click="cutoffFreq = 1.0e3" />
                <v-list-item title="100 Hz" @click="cutoffFreq = 100.0" />
                <v-list-item title="10 Hz" @click="cutoffFreq = 10.0" />
              </v-list>
            </v-menu>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="4">
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
          <v-col cols="7">
            <LogSlider
              v-model="q"
              :max="128.0"
              :min="0.01"
              thumb-label
              hide-details
              :disabled="!filterType.requiredParameter.includes('q')"
            />
          </v-col>
          <v-col cols="1">
            <v-menu>
              <template v-slot:activator="{ props }">
                <v-btn icon="" v-bind="props" variant="plain" density="compact">
                  <v-icon
                    v-if="(filterType.value === 'lowshelf' || filterType.value === 'highshelf') && soundPlaying"
                    color="warning"
                    icon="mdi-alert"
                  />
                  <v-icon v-else icon="mdi-dots-horizontal" />
                </v-btn>
              </template>
              <v-list>
                <v-list-item
                  v-if="(filterType.value === 'lowshelf' || filterType.value === 'highshelf') && soundPlaying"
                  title="再生される音には Q のパラメータは反映されません"
                  active-color="warning"
                  active
                  density="compact"
                />
                <v-list-item title="16.0000" @click="q = Math.pow(Math.SQRT2, 8)" />
                <v-list-item title="8.0000" @click="q = Math.pow(Math.SQRT2, 6)" />
                <v-list-item title="4.0000" @click="q = Math.pow(Math.SQRT2, 4)" />
                <v-list-item title="2.0000" @click="q = Math.pow(Math.SQRT2, 2)" />
                <v-list-item title="1.4142" @click="q = Math.SQRT2" />
                <v-list-item title="1.0000" @click="q = 1.0" />
                <v-list-item title="0.7071 (デフォルト)" @click="q = Math.SQRT1_2" />
                <v-list-item title="0.5000" @click="q = 0.5" />
              </v-list>
            </v-menu>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="4">
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
          <v-col cols="7">
            <v-slider
              v-model="gain"
              :max="40"
              :min="-40"
              :step="0.1"
              thumb-label
              hide-details
              :disabled="!filterType.requiredParameter.includes('gain')"
            >
              <template #thumb-label="{ modelValue }"> {{ Number(modelValue).toFixed(2) }} </template>
            </v-slider>
          </v-col>
          <v-col cols="1">
            <v-menu>
              <template v-slot:activator="{ props }">
                <v-btn icon="mdi-dots-horizontal" v-bind="props" variant="plain" density="compact" />
              </template>
              <v-list>
                <v-list-item title="+ 9.00 dB" @click="gain = 9.0" />
                <v-list-item title="+ 6.00 dB" @click="gain = 6.0" />
                <v-list-item title="+ 3.00 dB" @click="gain = 3.0" />
                <v-list-item title=" 0.00 dB" @click="gain = 0.0" />
                <v-list-item title="- 3.00 dB" @click="gain = -3.0" />
                <v-list-item title="- 6.00 dB" @click="gain = -6.0" />
                <v-list-item title="- 9.00 dB" @click="gain = -9.0" />
              </v-list>
            </v-menu>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="4">
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
          <v-col cols="7">
            <LogSlider v-model="samplingFreq" :max="192000" :min="10" thumb-label hide-details />
          </v-col>
          <v-col cols="1">
            <v-menu>
              <template v-slot:activator="{ props }">
                <v-btn icon="mdi-dots-horizontal" v-bind="props" variant="plain" density="compact" />
              </template>
              <v-list>
                <v-list-item title="192.000 kHz" @click="samplingFreq = 192.0e3" />
                <v-list-item title="96.000 kHz" @click="samplingFreq = 96.0e3" />
                <v-list-item title="88.200 kHz" @click="samplingFreq = 88.2e3" />
                <v-list-item title="48.000 kHz" @click="samplingFreq = 48.0e3" />
                <v-list-item title="44.100 kHz" @click="samplingFreq = 44.1e3" />
                <v-list-item title="32.000 kHz" @click="samplingFreq = 32.0e3" />
                <v-list-item title="22.050 Hz" @click="samplingFreq = 22.05e3" />
              </v-list>
            </v-menu>
          </v-col>
        </v-row>

        <v-row>
          <v-divider class="mt-3" />
          <v-col cols="4">
            <v-checkbox
              v-model="soundPlaying"
              label="音の再生"
              hide-details
              @click="clickSoundPlaying"
              density="compact"
            />
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="4">
            <SIValueInput
              v-model:value="soundVolume"
              label="ボリューム"
              variant="underlined"
              density="compact"
              unit="dB"
              :fraction-digits="2"
              :rule="[Rules.required, Rules.value]"
              hide-details
            />
          </v-col>
          <v-col cols="8">
            <v-slider v-model="soundVolume" :min="-80" :max="30" thumb-label />
          </v-col>
        </v-row>

        <v-row>
          <v-divider class="mb-3" />
          <v-col cols="6">
            <v-select
              label="インパルス長"
              density="compact"
              variant="underlined"
              v-model="impulseLength"
              :items="[256, 512, 1024, 2048, 4096, 8192, 16384, 32768]"
              hide-details
            />
          </v-col>
          <v-col cols="6">
            <v-select
              label="インパルス応答のグラフ長"
              density="compact"
              variant="underlined"
              v-model="impulseGraphLength"
              :items="Array.from({ length: Math.log2(impulseLength) - 2 }, (_, i) => 8 << i)"
              hide-details
            />
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="4">
            <SIValueInput
              v-model:value="chartMinimumMagnitude"
              label="周波数応答の最小振幅"
              variant="underlined"
              density="compact"
              unit="dB"
              :fraction-digits="0"
              :rule="[Rules.required, Rules.value]"
              hide-details
            />
          </v-col>
          <v-col cols="8">
            <v-slider v-model="chartMinimumMagnitude" :max="0" :min="-150" :step="10" thumb-label hide-details>
              <template #thumb-label="{ modelValue }"> {{ Number(modelValue).toFixed(0) }} </template>
            </v-slider>
          </v-col>
        </v-row>
      </v-col>
      <v-col cols="12" md="5" class="text-center">
        <v-row>
          <v-col cols="12">
            <object
              ref="diagram"
              class="diagram color-responsive"
              type="image/svg+xml"
              data="/tools/filter/biquad.svg"
              @load="onSVGLoaded"
            ></object>
          </v-col>
          <v-col cols="12">
            <div style="height: 250px">
              <ChartBase ref="chart" :initializer="initializeChart" />
            </div>
          </v-col>
          <v-col cols="12">
            <div style="height: 250px">
              <ChartBase ref="impulseChart" :initializer="initializeImpulseChart" />
            </div>
          </v-col>
        </v-row>
      </v-col>
    </v-row>
    <v-row>
      <v-divider />
      <v-col cols="6">
        <h4 class="mb-3">フィルタ係数</h4>
        <MathJax>
          <p class="mb-3">
            \( H(z) = \displaystyle\frac{b_0 + b_1 z^{-1} + b_2 z^{-2}}{a_0 + a_1 z^{-1} + a_2 z^{-2}} \)
          </p>
          <table class="ml-3">
            <tbody>
              <tr>
                <td>\( b_0 = \)</td>
                <td class="text-right">{{ coefficients[0].toFixed(9) }}</td>
              </tr>
              <tr>
                <td>\( b_1 = \)</td>
                <td class="text-right">{{ coefficients[1].toFixed(9) }}</td>
              </tr>
              <tr>
                <td>\( b_2 = \)</td>
                <td class="text-right">{{ coefficients[2].toFixed(9) }}</td>
              </tr>
              <tr>
                <td>\( a_0 = \)</td>
                <td class="text-right">{{ coefficients[3].toFixed(9) }}</td>
              </tr>
              <tr>
                <td>\( a_1 = \)</td>
                <td class="text-right">{{ coefficients[4].toFixed(9) }}</td>
              </tr>
              <tr>
                <td>\( a_2 = \)</td>
                <td class="text-right">{{ coefficients[5].toFixed(9) }}</td>
              </tr>
            </tbody>
          </table>
        </MathJax>
      </v-col>
      <v-col cols="6">
        <h4 class="mb-3">正規化フィルタ係数</h4>
        <MathJax>
          <p class="mb-3">
            \( H(z) = \displaystyle\frac{b_0 + b_1 z^{-1} + b_2 z^{-2}}{1 + a_1 z^{-1} + a_2 z^{-2}} \)
          </p>
          <table class="ml-3">
            <tbody>
              <tr>
                <td>\( b_0 = \)</td>
                <td class="text-right">{{ normalizedCoefficients[0].toFixed(9) }}</td>
              </tr>
              <tr>
                <td>\( b_1 = \)</td>
                <td class="text-right">{{ normalizedCoefficients[1].toFixed(9) }}</td>
              </tr>
              <tr>
                <td>\( b_2 = \)</td>
                <td class="text-right">{{ normalizedCoefficients[2].toFixed(9) }}</td>
              </tr>
              <tr>
                <td>\( a_1 = \)</td>
                <td class="text-right">{{ normalizedCoefficients[3].toFixed(9) }}</td>
              </tr>
              <tr>
                <td>\( a_2 = \)</td>
                <td class="text-right">{{ normalizedCoefficients[4].toFixed(9) }}</td>
              </tr>
            </tbody>
          </table>
        </MathJax>
      </v-col>
      <v-col cols="6">
        <h4 class="mb-3">カットオフ周波数の振幅</h4>
        <MathJax>
          <table class="text-right">
            <tbody>
              <tr>
                <td>\( f_c = \)</td>
                <td>{{ cutoffFreq.toFixed(3) }} [Hz]</td>
              </tr>
              <tr>
                <td>\( A_{f_c} = \)</td>
                <td>{{ Number.isNaN(magnitudeOnCutoff) ? '---' : magnitudeOnCutoff.toFixed(3) }} [dB]</td>
              </tr>
            </tbody>
          </table>
        </MathJax>
      </v-col>
      <v-col cols="6">
        <h4 class="mb-3">最大と最小振幅</h4>
        <MathJax>
          <table class="text-right">
            <tbody>
              <tr>
                <td>\( \max A = \)</td>
                <td>{{ maxMagnitude.toFixed(3) }} [dB]</td>
              </tr>
              <tr>
                <td>\( f_{\max A} = \)</td>
                <td>{{ maxMagnitudeFrequency.toFixed(3) }} [Hz]</td>
              </tr>
              <tr>
                <td class="mb-2">\( \min A = \)</td>
                <td>{{ minMagnitude.toFixed(3) }} [dB]</td>
              </tr>
              <tr>
                <td>\( f_{\min A} = \)</td>
                <td>{{ minMagnitudeFrequency.toFixed(3) }} [Hz]</td>
              </tr>
            </tbody>
          </table>
        </MathJax>
      </v-col>
      <v-col cols="6">
        <h4 class="mb-3">インパルス応答の総和</h4>
        <MathJax>
          <p>
            <span> \( \displaystyle\sum^{N-1}_{n=0} y[n] = \) </span>
            {{ sumImpulse.toFixed(6) }}
          </p>
        </MathJax>
      </v-col>
    </v-row>

    <template #footer>
      <v-divider />
      <v-footer>
        <v-container>
          <h4>参考文献</h4>
          <ul>
            <li>
              <a href="https://webaudio.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html" target="_blank"
                >Cookbook formulae for audio equalizer biquad filter coefficients</a
              >
            </li>
            <li>
              <a href="https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode/type" target="_blank"
                >BiquadFilterNode: type property</a
              >
              - Web APIs | MDN
            </li>
          </ul>
        </v-container>
      </v-footer>
    </template>
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
