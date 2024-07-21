<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Rules } from '@/lib/siPrefix';
import { useTheme } from 'vuetify';
import { reapplyTheme } from '@/lib/theme';
import { BiquadFilter, type BiquadFilterType } from '@/lib/filter/biquadFilter';
import Chart, { type ChartDataset } from 'chart.js/auto';
import annotationPlugin, { type AnnotationOptions } from 'chartjs-plugin-annotation';

import AppBase from '@/components/common/AppBase.vue';
import SIValueInput from '@/components/input/SIValueInput.vue';
import ChartBase from '@/components/common/ChartBase.vue';
import LogSlider from '@/components/input/LogSlider.vue';

Chart.register(annotationPlugin);

interface FilterType {
  title: string;
  value: BiquadFilterType;
  requiredParameter: ('q' | 'bandwidth' | 'gain')[];
}

const filterTypeItem: FilterType[] = [
  {
    title: 'ローパスフィルタ (LPF)',
    value: 'lowpass',
    requiredParameter: ['q'],
  },
  {
    title: 'ハイパスフィルタ (HPF)',
    value: 'highpass',
    requiredParameter: ['q'],
  },
  {
    title: 'バンドパスフィルタ (BPF)',
    value: 'bandpass',
    requiredParameter: ['q', 'bandwidth'],
  },
  {
    title: 'バンドストップフィルタ (BSF)',
    value: 'bandstop',
    requiredParameter: ['bandwidth'],
  },
  {
    title: 'ローシェルフフィルタ (LSF)',
    value: 'lowshelf',
    requiredParameter: ['q', 'gain'],
  },
  {
    title: 'ハイシェルフフィルタ (HSF)',
    value: 'highshelf',
    requiredParameter: ['q', 'gain'],
  },
  {
    title: 'ピーキングフィルタ (Peaking)',
    value: 'peaking',
    requiredParameter: ['bandwidth', 'gain'],
  },
  {
    title: 'オールパスフィルタ (Allpass)',
    value: 'allpass',
    requiredParameter: ['q'],
  },
];

const theme = useTheme();
const diagram = ref<HTMLObjectElement>();
const filterType = ref<FilterType>(filterTypeItem[0]);
const chart = ref<InstanceType<typeof ChartBase>>();
const impulseChart = ref<InstanceType<typeof ChartBase>>();

const cutoffFreq = ref<number>(1000.0);
const q = ref<number>(0.707106781);
const bandwidth = ref<number>(1.0);
const gain = ref<number>(0.0);
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
      label: '周波数応答 (dB)',
      data: [...biquadFilter.value.frequencyResponse],
      pointStyle: false,
      yAxisID: 'y',
    },
    {
      label: '位相応答 (deg)',
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
    bandwidth: bandwidth.value,
    gain: gain.value,
  });

  updateDiagram();
  updateGraph();
  updateImpulseGraph();
}

watch(
  () => [filterType.value, cutoffFreq.value, q.value, bandwidth.value, gain.value, samplingFreq.value],
  updateFilterCoefficients,
);

function onSVGLoaded() {
  reapplyTheme(theme);
  updateFilterCoefficients();

  if (diagram.value) {
    diagram.value.style.opacity = '1';
  }
}

function initializeChart(canvas: HTMLCanvasElement): Chart {
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [],
      labels: Array(impulseLength.value / 2)
        .fill(0)
        .map((_, i) => i),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        // tooltip: {
        //   callbacks: {
        //     label: function (item: TooltipItem<'bar'>) {
        //       return `${item.dataset.label}`;
        //     },
        //     footer: function footer(items: TooltipItem<'bar'>[]): string {
        //       // const { type, value } = items[0].raw as { value: number; type: string };
        //       // return `${dayjs.duration(value, 'seconds').format('H時間m分s秒')}`;
        //       return 'test';
        //     },
        //   },
        // },
      },
      parsing: {
        xAxisKey: 'x',
        yAxisKey: 'y',
      },
      scales: {
        x: {
          type: 'logarithmic',
          min: 20.0,
        },
        y: {
          type: 'linear',
          max: 20.0,
          min: -60.0,
        },
        y1: {
          type: 'linear',
          position: 'right',
          max: 180.0,
          min: -180.0,
          ticks: {
            stepSize: 90,
          },
          grid: {
            drawOnChartArea: false, // only want the grid lines for one axis to show up
          },
        },
      },
    },
  });
}

function initializeImpulseChart(canvas: HTMLCanvasElement): Chart {
  return new Chart(canvas, {
    type: 'bar',
    data: {
      datasets: [],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          type: 'linear',
        },
      },
    },
  });
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
            <LogSlider v-model="cutoffFreq" :max="samplingFreq / 2" :min="10" thumb-label hide-details />
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
            <LogSlider
              v-model="q"
              :max="16.0"
              :min="0.0001"
              thumb-label
              hide-details
              :disabled="!filterType.requiredParameter.includes('q')"
            />
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
            <LogSlider v-model="samplingFreq" :max="192000" :min="10" thumb-label hide-details />
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
            <div style="max-height: 500px">
              <ChartBase ref="chart" :initializer="initializeChart" />
            </div>
          </v-col>
          <v-col cols="12">
            <div style="max-height: 500px">
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
