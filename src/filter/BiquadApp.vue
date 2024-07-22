<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Rules } from '@/lib/siPrefix';
import { useTheme } from 'vuetify';
import { reapplyTheme } from '@/lib/theme';
import { BiquadFilter } from '@/lib/filter/biquadFilter';
import Chart, { type ChartDataset } from 'chart.js/auto';
import annotationPlugin, { type AnnotationOptions } from 'chartjs-plugin-annotation';
import * as Tone from 'tone';

import AppBase from '@/components/common/AppBase.vue';
import SIValueInput from '@/components/input/SIValueInput.vue';
import ChartBase from '@/components/common/ChartBase.vue';
import LogSlider from '@/components/input/LogSlider.vue';

import { type FilterType, filterTypeItem, chartOptions, impulseChartOptions } from './biquadAppConfig';

Chart.register(annotationPlugin);

const theme = useTheme();
const diagram = ref<HTMLObjectElement>();
const filterType = ref<FilterType>(filterTypeItem[0]);
const chart = ref<InstanceType<typeof ChartBase>>();
const impulseChart = ref<InstanceType<typeof ChartBase>>();

const cutoffFreq = ref<number>(1000.0);
const q = ref<number>(0.707106781);
const gain = ref<number>(6.0);
const samplingFreq = ref<number>(48000.0);

const impulseLength = ref<number>(1024);
const biquadFilter = computed<BiquadFilter>(() => new BiquadFilter(impulseLength.value));
const graphXLabel = computed<number[]>(() => {
  const array = Array(impulseLength.value / 2).fill(0);

  for (let i = 0; i < array.length; i++) {
    array[i] = (samplingFreq.value / 2 / array.length) * i;
  }

  return array;
});

const soundPlaying = ref<boolean>();
const soundVolume = ref<number>(-30);
let synth: Tone.Noise | null = null;
let toneFilter: Tone.BiquadFilter | null = null;

function updateDiagram() {
  function setTextContent(document: Document | null | undefined, id: string, text: string) {
    if (document) {
      const element = document.getElementById(id);

      if (element) {
        element.textContent = text;
      }
    }
  }

  const diagram = window.document.querySelector('.diagram');

  if (diagram) {
    const diagramDom = (diagram as HTMLObjectElement).contentDocument;
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

    for (let i = 0; i < impulseLength.value; i++) {
      const currentValue = biquadFilter.value.phaseResponse[i];

      if (Math.abs(currentValue - prevValue) >= 120.0 && i < impulseLength.value - 1) {
        data.push({ x: (graphXLabel.value[i] + graphXLabel.value[i + 1]) / 2, y: Number.NaN });
      }

      data.push({ x: graphXLabel.value[i], y: biquadFilter.value.phaseResponse[i] });
      prevValue = currentValue;
    }

    return data;
  }

  const datasets: ChartDataset<'line', { x: number; y: number }[] | number[]>[] = [
    {
      label: '振幅 (dB)',
      data: [...biquadFilter.value.frequencyResponse],
      pointStyle: false,
      yAxisID: 'y',
    },
    {
      label: '位相 (deg)',
      data: segmentedPhaseResponse(),
      pointStyle: false,
      yAxisID: 'y1',
    },
  ];

  if (chartState.chart.options.scales?.x) {
    chartState.chart.options.scales.x.max = samplingFreq.value / 2;
  }

  const annotations = chartState.chart.options.plugins?.annotation?.annotations as
    | Record<string, AnnotationOptions>
    | undefined;

  if (annotations) {
    const annotationOptions: AnnotationOptions = {
      type: 'line',
      xMax: cutoffFreq.value,
      xMin: cutoffFreq.value,
      z: 10,
      borderColor: '#aaa',
      borderWidth: 2,
      borderDash: [5],
    };

    annotations['cutoffFreqLine'] = annotationOptions;
  }

  chartState.chart.scales.y.options.max = Math.round(Math.max(0, ...biquadFilter.value.frequencyResponse) + 10);
  chartState.chart.data.labels = graphXLabel.value;
  chartState.chart.data.datasets = datasets as unknown as ChartDataset<'line', number[]>[];
  chartState.chart.update('none');
}

function updateImpulseGraph() {
  const chartState = impulseChart.value?.getChart();

  if (!chartState || !chartState.ready) {
    return;
  }

  const datasets: ChartDataset<'bar', number[]>[] = [
    {
      label: 'インパルス応答',
      data: [...biquadFilter.value.impluseResponse.slice(0, impulseLength.value / 4)],
      pointStyle: false,
      borderWidth: 0,
      backgroundColor: 'rgb(54, 162, 235)',
    },
  ];

  if (chartState.chart.data.labels?.length != impulseLength.value / 4) {
    chartState.chart.data.labels = Array(impulseLength.value / 4)
      .fill(0)
      .map((_, i) => i);
  }

  chartState.chart.data.datasets = datasets as unknown as ChartDataset<'bar', number[]>[];
  chartState.chart.update('none');
}

function updateFilterCoefficients() {
  biquadFilter.value.setFilter(filterType.value.value, samplingFreq.value, cutoffFreq.value, {
    q: q.value,
    gain: gain.value,
  });

  updateDiagram();
  updateGraph();
  updateImpulseGraph();
}

watch(
  () => [filterType.value, cutoffFreq.value, q.value, gain.value, samplingFreq.value],
  () => {
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
                <v-btn icon="mdi-dots-horizontal" v-bind="props" variant="plain" density="compact" />
              </template>
              <v-list>
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
          <v-divider />
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
