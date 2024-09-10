<script setup lang="ts">
import { ref, watch } from 'vue';
import { deepAssign } from '@nanase/alnilam/object';
import { Rules } from '@nanase/alnilam/inputRule';
import { PIDController } from './PIDController';
import Chart from 'chart.js/auto';

import ToolAppBase from '@/components/common/ToolAppBase.vue';
import ChartBase from '@/components/common/ChartBase.vue';
import InputRow from '@/components/input/InputRow.vue';

const positionChart = ref<InstanceType<typeof ChartBase>>();
const velocityChart = ref<InstanceType<typeof ChartBase>>();

const initialPosition = ref<number>(0.0);
const initialVelocity = ref<number>(0.0);
const targetPosition = ref<number>(50.0);
const riverSpeed = ref<number>(-1.0);
const responsiveness = ref<number>(0.05);
const kp = ref<number>(0.00001);
const ki = ref<number>(0.00001);
const kd = ref<number>(0.00001);

watch(
  () => [
    initialPosition.value,
    initialVelocity.value,
    targetPosition.value,
    riverSpeed.value,
    responsiveness.value,
    kp.value,
    ki.value,
    kd.value,
    positionChart.value,
    velocityChart.value,
  ],
  () => {
    updateChart();
  },
);

function initializePositionChart(canvas: HTMLCanvasElement): Chart {
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [],
      labels: [],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
        },
        y: {
          type: 'linear',
        },
      },
    },
  });
}

function initializeVelocityChart(canvas: HTMLCanvasElement): Chart {
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [],
      labels: [],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
        },
        y: {
          type: 'linear',
        },
      },
    },
  });
}

function updateChart() {
  const pidController = new PIDController(kp.value, ki.value, kd.value);
  const dt = 0.1;
  const length = 1000;
  let position = initialPosition.value;
  let velocity = initialVelocity.value;
  let acceleration = 0.0;
  const positions: { x: number; y: number }[] = Array(length);
  const velocities: { x: number; y: number }[] = Array(length);
  positions[0] = { x: 0, y: position };
  velocities[0] = { x: 0, y: velocity };

  for (let i = 1; i < length; i++) {
    const control = pidController.calculate(targetPosition.value, position, dt);
    acceleration += (control * dt - acceleration) * responsiveness.value;
    velocity += acceleration;
    position += (velocity + riverSpeed.value) * dt;

    positions[i] = { x: i * dt, y: position };
    velocities[i] = { x: i * dt, y: velocity };
  }

  const positionChartState = positionChart.value?.getChart();
  const velocityChartState = velocityChart.value?.getChart();

  if (positionChartState && positionChartState.ready) {
    deepAssign(positionChartState.chart, {
      data: {
        datasets: [
          {
            label: '位置 (m)',
            data: positions,
            pointStyle: false,
            yAxisID: 'y',
            borderColor: '#36A2EB',
            backgroundColor: '#9BD0F5',
            hidden:
              typeof positionChartState.chart.data.datasets[0]?.hidden === 'undefined'
                ? false
                : !positionChartState.chart.isDatasetVisible(0),
          },
        ],
      },
    }).update('none');
  }

  if (velocityChartState && velocityChartState.ready) {
    deepAssign(velocityChartState.chart, {
      data: {
        datasets: [
          {
            label: '速度 (m/s)',
            data: velocities,
            pointStyle: false,
            yAxisID: 'y',
            borderColor: '#FF6384',
            backgroundColor: '#FFB1C1',
            hidden:
              typeof velocityChartState.chart.data.datasets[0]?.hidden === 'undefined'
                ? false
                : !velocityChartState.chart.isDatasetVisible(0),
          },
        ],
      },
    }).update('none');
  }
}
</script>

<template>
  <ToolAppBase page-id="control/pid" toolbar-title="PID制御">
    <v-row>
      <v-col cols="12" md="6">
        <InputRow
          v-model="initialPosition"
          label="初期位置"
          variant="underlined"
          density="compact"
          :max="100"
          :min="-100"
          unit="m"
          :fraction-digits="3"
          :rule="[Rules.required, Rules.value]"
          cols="4"
          hide-details
        >
        </InputRow>

        <InputRow
          v-model="targetPosition"
          label="目標位置"
          variant="underlined"
          density="compact"
          :max="100"
          :min="-100"
          unit="m"
          :fraction-digits="3"
          :rule="[Rules.required, Rules.value]"
          cols="4"
          hide-details
        >
        </InputRow>

        <InputRow
          v-model="initialVelocity"
          label="初速"
          variant="underlined"
          density="compact"
          :max="100"
          :min="-100"
          unit="m/s"
          :fraction-digits="3"
          :rule="[Rules.required, Rules.value]"
          cols="4"
          hide-details
        >
        </InputRow>

        <InputRow
          v-model="riverSpeed"
          label="周囲の流速"
          variant="underlined"
          density="compact"
          :max="100"
          :min="-100"
          unit="m/s"
          :fraction-digits="3"
          :rule="[Rules.required, Rules.value]"
          cols="4"
          hide-details
        >
        </InputRow>

        <InputRow
          v-model="responsiveness"
          label="加速の応答性"
          variant="underlined"
          density="compact"
          :max="1"
          :min="0.0001"
          scale="log"
          :fraction-digits="4"
          :rule="[Rules.required, Rules.value]"
          cols="4"
          hide-details
        >
        </InputRow>

        <v-divider class="my-5" />

        <InputRow
          v-model="kp"
          label="Kp"
          variant="underlined"
          density="compact"
          :max="20.0001"
          :min="0.0001"
          :constant="0.0001"
          scale="log"
          :fraction-digits="4"
          :rule="[Rules.required, Rules.value, Rules.notNegative]"
          cols="4"
          hide-details
        >
        </InputRow>

        <InputRow
          v-model="ki"
          label="Ki"
          variant="underlined"
          density="compact"
          :max="20.0001"
          :min="0.0001"
          :constant="0.0001"
          scale="log"
          :fraction-digits="4"
          :rule="[Rules.required, Rules.value, Rules.notNegative]"
          cols="4"
          hide-details
        >
        </InputRow>

        <InputRow
          v-model="kd"
          label="Kd"
          variant="underlined"
          density="compact"
          :max="20.0001"
          :min="0.0001"
          :constant="0.0001"
          scale="log"
          :fraction-digits="4"
          :rule="[Rules.required, Rules.value, Rules.notNegative]"
          cols="4"
          hide-details
        >
        </InputRow>
      </v-col>

      <v-col cols="12" md="6" class="text-center">
        <v-row>
          <v-col cols="12">
            <div style="height: 250px">
              <ChartBase ref="positionChart" :initializer="initializePositionChart" />
            </div>
          </v-col>
          <v-col cols="12">
            <div style="height: 250px">
              <ChartBase ref="velocityChart" :initializer="initializeVelocityChart" />
            </div>
          </v-col>
        </v-row>
      </v-col>
    </v-row>
  </ToolAppBase>
</template>
