<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useIntervalFn, useWebWorker } from '@vueuse/core';
import { deepAssign, RawObject } from '@nanase/alnilam/object';
import { divide, findMinMax, sequence } from '@nanase/alnilam/array';
import { Rules } from '@nanase/alnilam/inputRule';
import { BiquadFilter } from '@/lib/filter/biquadFilter';
import Chart from 'chart.js/auto';
import annotationPlugin from 'chartjs-plugin-annotation';
import * as Tone from 'tone';
import { DropdownMenuItem } from 'radix-vue';
import MathJax from '@/components/common/MathJax.vue';
import type { WorkerParameter, WorkerResult } from './biquadWorkerType';
import biquadWorker from './biquadWorker?worker';

import ChartBase from '@/components/common/ChartBase.vue';
import InputRow from '@/components/input/InputRow.vue';
import SignalIndicator from '@/components/common/SignalIndicator.vue';

import {
  type FilterType,
  filterTypeItem,
  chartOptions,
  impulseChartOptions,
  cutoffAnnotationOptions,
} from './biquadAppConfig';

Chart.register(annotationPlugin);

const diagram = ref<HTMLObjectElement>();
const filterType = ref<FilterType>(filterTypeItem[0]);
const chart = ref<InstanceType<typeof ChartBase>>();
const impulseChart = ref<InstanceType<typeof ChartBase>>();
const chartMinimumMagnitude = ref<number>(-60.0);
const processingPreciseCalc = ref<boolean>(false);

const cutoffFreq = ref<number>(1000.0);
const q = ref<number>(0.707106781);
const gain = ref<number>(6.0);
const samplingFreq = ref<number>(48000.0);

const impulseLength = ref<number>(1024);
const impulseGraphLength = ref<number>(1024 / 4);
const lastCalcImpulseLength = ref<number>(1024);
const preciseImpulseLength = ref<number>(2 ** 16);
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
const soundSignal = ref<number>(-Infinity);
let synth: Tone.Noise | null = null;
let meter: Tone.Meter | null = null;
let toneFilter: Tone.BiquadFilter | null = null;
const { data: biquadWorkerResult, post: postToBiquadWorker } = useWebWorker<WorkerResult>(new biquadWorker());

const impulseLengthOptions = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
const impulseGraphLengthOptions = computed(() =>
  Array.from({ length: Math.log2(impulseLength.value) - 2 }, (_, i) => 8 << i),
);
const preciseImpulseLengthOptions = computed(() => sequence(16, 25).map((b) => 2 ** b));

function updateDiagram() {
  function setTextContent(document: Document | null | undefined, id: string, text: string) {
    deepAssign(document?.getElementById(id), { textContent: text });
  }

  const diagramEl = window.document.querySelector<HTMLObjectElement>('.diagram');

  if (diagramEl) {
    const diagramDom = diagramEl.contentDocument;
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
  lastCalcImpulseLength.value = impulseLength.value;
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
      meter = new Tone.Meter({ smoothing: 0 });
      toneFilter.connect(meter);
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

useIntervalFn(() => {
  if (meter) {
    const rawValue = meter.getValue();
    soundSignal.value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  }
}, 200);

async function invokePreciseCalc() {
  if (processingPreciseCalc.value) {
    return;
  }

  processingPreciseCalc.value = true;
  postToBiquadWorker({
    impulseLength: preciseImpulseLength.value,
    filterType: filterType.value.value,
    samplingFreq: samplingFreq.value,
    cutoffFreq: cutoffFreq.value,
    q: q.value,
    gain: gain.value,
  } as const satisfies WorkerParameter);
}

watch(
  () => biquadWorkerResult.value,
  (result) => {
    ({
      magnitudeOnCutoff: magnitudeOnCutoff.value,
      maxMagnitude: maxMagnitude.value,
      minMagnitude: minMagnitude.value,
      maxMagnitudeFrequency: maxMagnitudeFrequency.value,
      minMagnitudeFrequency: minMagnitudeFrequency.value,
      sumImpulse: sumImpulse.value,
    } = result);
    lastCalcImpulseLength.value = preciseImpulseLength.value;
    processingPreciseCalc.value = false;
  },
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid grid-cols-1 gap-6 md:grid-cols-[7fr_5fr]">
      <!-- Left column: Controls -->
      <div class="flex flex-col gap-2">
        <!-- Filter type -->
        <div class="flex flex-col gap-0.5">
          <label class="text-xs text-[var(--color-on-background)] opacity-60">フィルタタイプ</label>
          <select
            class="border-b border-[var(--color-on-background)]/30 bg-transparent py-1 text-sm outline-none focus:border-[var(--color-primary)]"
            :value="filterTypeItem.indexOf(filterType)"
            @change="filterType = filterTypeItem[Number(($event.target as HTMLSelectElement).value)]"
          >
            <option v-for="(item, index) in filterTypeItem" :key="item.value" :value="index">
              {{ item.title }}
            </option>
          </select>
        </div>

        <!-- Cutoff frequency -->
        <InputRow
          v-model="cutoffFreq"
          label="カットオフ周波数"
          unit="Hz"
          scale="log"
          :max="samplingFreq / 2"
          :min="10"
          :fraction-digits="3"
          :prefix-symbols="['G', 'M', 'k', '']"
          :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
        >
          <template #menu-list>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="cutoffFreq = 10.0e3">10 kHz</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="cutoffFreq = 1.0e3">1 kHz</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="cutoffFreq = 100.0">100 Hz</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="cutoffFreq = 10.0">10 Hz</DropdownMenuItem>
          </template>
        </InputRow>

        <!-- Q -->
        <InputRow
          v-model="q"
          label="Q"
          scale="log"
          :max="128.0"
          :min="0.01"
          :fraction-digits="4"
          :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
        >
          <template #menu-list>
            <DropdownMenuItem
              v-if="(filterType.value === 'lowshelf' || filterType.value === 'highshelf') && soundPlaying"
              class="px-3 py-1.5 text-xs text-amber-500"
              disabled
            >
              再生される音には Q のパラメータは反映されません
            </DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="q = Math.pow(Math.SQRT2, 8)">16.0000</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="q = Math.pow(Math.SQRT2, 6)">8.0000</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="q = Math.pow(Math.SQRT2, 4)">4.0000</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="q = Math.pow(Math.SQRT2, 2)">2.0000</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="q = Math.SQRT2">1.4142</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="q = 1.0">1.0000</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="q = Math.SQRT1_2">0.7071 (デフォルト)</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="q = 0.5">0.5000</DropdownMenuItem>
          </template>
        </InputRow>

        <!-- Gain -->
        <InputRow
          v-model="gain"
          label="増幅量"
          unit="dB"
          :max="40"
          :min="-40"
          :step="0.1"
          :fraction-digits="2"
          :rule="[Rules.required, Rules.value]"
          :disabled="!filterType.requiredParameter.includes('gain')"
        >
          <template #menu-list>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="gain = 9.0">+ 9.00 dB</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="gain = 6.0">+ 6.00 dB</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="gain = 3.0">+ 3.00 dB</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="gain = 0.0"> 0.00 dB</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="gain = -3.0">- 3.00 dB</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="gain = -6.0">- 6.00 dB</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="gain = -9.0">- 9.00 dB</DropdownMenuItem>
          </template>
        </InputRow>

        <!-- Sampling frequency -->
        <InputRow
          v-model="samplingFreq"
          label="サンプリング周波数"
          unit="Hz"
          scale="log"
          :max="192000"
          :min="10"
          :fraction-digits="3"
          :prefix-symbols="['G', 'M', 'k', '']"
          :rule="[Rules.required, Rules.value, Rules.notNegative, Rules.notZero]"
        >
          <template #menu-list>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="samplingFreq = 192.0e3">192.000 kHz</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="samplingFreq = 96.0e3">96.000 kHz</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="samplingFreq = 88.2e3">88.200 kHz</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="samplingFreq = 48.0e3">48.000 kHz</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="samplingFreq = 44.1e3">44.100 kHz</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="samplingFreq = 32.0e3">32.000 kHz</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--color-on-background)]/10" @select="samplingFreq = 22.05e3">22.050 kHz</DropdownMenuItem>
          </template>
        </InputRow>

        <!-- Sound playback -->
        <div class="border-t border-[var(--color-on-background)]/10 pt-3">
          <div class="grid grid-cols-[auto_1fr] items-center gap-4">
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                v-model="soundPlaying"
                class="accent-[var(--color-primary)]"
                @click="clickSoundPlaying"
              />
              音の再生
            </label>
            <div class="flex gap-0.5">
              <SignalIndicator
                style="height: 16px; flex: 1"
                :value="soundSignal"
                :max="-30"
                :min="-50"
                :disabled="!soundPlaying"
              />
              <SignalIndicator
                style="height: 16px; flex: 1"
                :value="soundSignal"
                :max="-9"
                :min="-30"
                :disabled="!soundPlaying"
                fillColor="orange"
                strokeColor="orange"
              />
              <SignalIndicator
                style="height: 16px; flex: 1"
                :value="soundSignal"
                :max="0"
                :min="-9"
                :disabled="!soundPlaying"
                fillColor="red"
                strokeColor="red"
              />
            </div>
          </div>
        </div>

        <InputRow
          v-model="soundVolume"
          label="ボリューム"
          unit="dB"
          :min="-80"
          :max="30"
          :fraction-digits="2"
          :rule="[Rules.required, Rules.value]"
        />

        <!-- Impulse settings -->
        <div class="border-t border-[var(--color-on-background)]/10 pt-3">
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-0.5">
              <label class="text-xs text-[var(--color-on-background)] opacity-60">インパルス長</label>
              <select
                class="border-b border-[var(--color-on-background)]/30 bg-transparent py-1 text-sm outline-none focus:border-[var(--color-primary)]"
                :value="impulseLength"
                @change="impulseLength = Number(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="len in impulseLengthOptions" :key="len" :value="len">{{ len }}</option>
              </select>
            </div>
            <div class="flex flex-col gap-0.5">
              <label class="text-xs text-[var(--color-on-background)] opacity-60">インパルス応答のグラフ長</label>
              <select
                class="border-b border-[var(--color-on-background)]/30 bg-transparent py-1 text-sm outline-none focus:border-[var(--color-primary)]"
                :value="impulseGraphLength"
                @change="impulseGraphLength = Number(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="len in impulseGraphLengthOptions" :key="len" :value="len">{{ len }}</option>
              </select>
            </div>
          </div>
        </div>

        <InputRow
          v-model="chartMinimumMagnitude"
          label="周波数応答の最小振幅"
          unit="dB"
          :max="0"
          :min="-150"
          :step="10"
          :rule="[Rules.required, Rules.value]"
        />
      </div>

      <!-- Right column: Diagram + Charts -->
      <div class="flex flex-col items-center gap-4">
        <object
          ref="diagram"
          class="diagram color-responsive w-full max-w-[400px]"
          type="image/svg+xml"
          data="/tools/filter/biquad.svg"
          @load="onSVGLoaded"
        />
        <div class="h-[250px] w-full">
          <ChartBase ref="chart" :initializer="initializeChart" />
        </div>
        <div class="h-[250px] w-full">
          <ChartBase ref="impulseChart" :initializer="initializeImpulseChart" />
        </div>
      </div>
    </div>

    <!-- Filter coefficients -->
    <div class="border-t border-[var(--color-on-background)]/10 pt-4">
      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h4 class="mb-3 font-semibold">フィルタ係数</h4>
          <MathJax tag="p" class="mb-3">
            H(z) = \displaystyle\frac{b_0 + b_1 z^{-1} + b_2 z^{-2}}{a_0 + a_1 z^{-1} + a_2 z^{-2}}
          </MathJax>
          <table class="ml-3 text-sm">
            <tbody>
              <tr>
                <MathJax tag="td">b_0 =</MathJax>
                <td class="text-right">{{ coefficients[0].toFixed(9) }}</td>
              </tr>
              <tr>
                <MathJax tag="td">b_1 =</MathJax>
                <td class="text-right">{{ coefficients[1].toFixed(9) }}</td>
              </tr>
              <tr>
                <MathJax tag="td">b_2 =</MathJax>
                <td class="text-right">{{ coefficients[2].toFixed(9) }}</td>
              </tr>
              <tr>
                <MathJax tag="td">a_0 =</MathJax>
                <td class="text-right">{{ coefficients[3].toFixed(9) }}</td>
              </tr>
              <tr>
                <MathJax tag="td">a_1 =</MathJax>
                <td class="text-right">{{ coefficients[4].toFixed(9) }}</td>
              </tr>
              <tr>
                <MathJax tag="td">a_2 =</MathJax>
                <td class="text-right">{{ coefficients[5].toFixed(9) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4 class="mb-3 font-semibold">正規化フィルタ係数</h4>
          <MathJax tag="p" class="mb-3">
            H(z) = \displaystyle\frac{b_0 + b_1 z^{-1} + b_2 z^{-2}}{1 + a_1 z^{-1} + a_2 z^{-2}}
          </MathJax>
          <table class="ml-3 text-sm">
            <tbody>
              <tr>
                <MathJax tag="td">b_0 =</MathJax>
                <td class="text-right">{{ normalizedCoefficients[0].toFixed(9) }}</td>
              </tr>
              <tr>
                <MathJax tag="td">b_1 =</MathJax>
                <td class="text-right">{{ normalizedCoefficients[1].toFixed(9) }}</td>
              </tr>
              <tr>
                <MathJax tag="td">b_2 =</MathJax>
                <td class="text-right">{{ normalizedCoefficients[2].toFixed(9) }}</td>
              </tr>
              <tr>
                <MathJax tag="td">a_1 =</MathJax>
                <td class="text-right">{{ normalizedCoefficients[3].toFixed(9) }}</td>
              </tr>
              <tr>
                <MathJax tag="td">a_2 =</MathJax>
                <td class="text-right">{{ normalizedCoefficients[4].toFixed(9) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Precise calculation -->
    <div class="border-t border-[var(--color-on-background)]/10 pt-4">
      <h4 class="mb-4 font-semibold">インパルス長</h4>
      <div class="mb-3 grid grid-cols-[1fr_auto] items-end gap-4">
        <div class="flex flex-col gap-0.5">
          <label class="text-xs text-[var(--color-on-background)] opacity-60">インパルス長</label>
          <select
            class="border-b border-[var(--color-on-background)]/30 bg-transparent py-1 text-sm outline-none focus:border-[var(--color-primary)]"
            :value="preciseImpulseLength"
            :disabled="processingPreciseCalc"
            @change="preciseImpulseLength = Number(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="len in preciseImpulseLengthOptions" :key="len" :value="len">{{ len }}</option>
          </select>
        </div>
        <button
          class="rounded border border-[var(--color-on-background)]/30 px-4 py-1.5 text-sm transition-colors hover:bg-[var(--color-on-background)]/10 disabled:opacity-40"
          :disabled="processingPreciseCalc || preciseImpulseLength === lastCalcImpulseLength"
          @click="invokePreciseCalc"
        >
          {{ processingPreciseCalc ? '計算中...' : '再計算' }}
        </button>
      </div>
      <p class="mb-4 text-sm">
        計算時のインパルス長 <MathJax>N = </MathJax> {{ lastCalcImpulseLength }}（周波数分解能
        <MathJax>\frac{f_c}{N} = </MathJax> {{ (samplingFreq / lastCalcImpulseLength).toFixed(3) }} [Hz]）
      </p>

      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h4 class="mb-3 font-semibold">カットオフ周波数の振幅</h4>
          <table class="text-right text-sm">
            <tbody>
              <tr>
                <MathJax tag="td">f_c =</MathJax>
                <td>{{ cutoffFreq.toFixed(3) }} [Hz]</td>
              </tr>
              <tr>
                <MathJax tag="td">A_{f_c} =</MathJax>
                <td>{{ Number.isNaN(magnitudeOnCutoff) ? '---' : magnitudeOnCutoff.toFixed(3) }} [dB]</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4 class="mb-3 font-semibold">最大と最小振幅</h4>
          <table class="text-right text-sm">
            <tbody>
              <tr>
                <MathJax tag="td">\max A =</MathJax>
                <td>{{ maxMagnitude.toFixed(3) }} [dB]</td>
              </tr>
              <tr>
                <MathJax tag="td">f_{\max A} =</MathJax>
                <td>{{ maxMagnitudeFrequency.toFixed(3) }} [Hz]</td>
              </tr>
              <tr>
                <MathJax tag="td" class="mb-2">\min A =</MathJax>
                <td>{{ minMagnitude.toFixed(3) }} [dB]</td>
              </tr>
              <tr>
                <MathJax tag="td">f_{\min A} =</MathJax>
                <td>{{ minMagnitudeFrequency.toFixed(3) }} [Hz]</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4 class="mb-3 font-semibold">インパルス応答の総和</h4>
          <p class="text-sm">
            <MathJax>\displaystyle\sum^{N-1}_{n=0} y[n] =</MathJax> {{ sumImpulse.toFixed(6) }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.diagram {
  opacity: 0;
  transition: opacity 0.15s ease;
}
</style>
