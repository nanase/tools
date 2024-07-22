import { type BiquadFilterType } from '@/lib/filter/biquadFilter';
import type { ChartConfiguration } from 'chart.js/auto';
import * as Tone from 'tone';

export interface FilterType {
  title: string;
  value: BiquadFilterType;
  requiredParameter: ('q' | 'gain')[];
  toneFilterType: Tone.BiquadFilterOptions['type'];
}

export const filterTypeItem: FilterType[] = [
  {
    title: 'ローパスフィルタ (LPF)',
    value: 'lowpass',
    requiredParameter: ['q'],
    toneFilterType: 'lowpass',
  },
  {
    title: 'ハイパスフィルタ (HPF)',
    value: 'highpass',
    requiredParameter: ['q'],
    toneFilterType: 'highpass',
  },
  {
    title: 'バンドパスフィルタ (BPF)',
    value: 'bandpass',
    requiredParameter: ['q'],
    toneFilterType: 'bandpass',
  },
  {
    title: 'バンドストップフィルタ (BSF, Notch)',
    value: 'bandstop',
    requiredParameter: ['q'],
    toneFilterType: 'notch',
  },
  {
    title: 'ローシェルフフィルタ (LSF)',
    value: 'lowshelf',
    requiredParameter: ['q', 'gain'],
    toneFilterType: 'lowshelf',
  },
  {
    title: 'ハイシェルフフィルタ (HSF)',
    value: 'highshelf',
    requiredParameter: ['q', 'gain'],
    toneFilterType: 'highshelf',
  },
  {
    title: 'ピーキングフィルタ (Peaking)',
    value: 'peaking',
    requiredParameter: ['q', 'gain'],
    toneFilterType: 'peaking',
  },
  {
    title: 'オールパスフィルタ (Allpass)',
    value: 'allpass',
    requiredParameter: ['q'],
    toneFilterType: 'allpass',
  },
];

export const chartOptions: ChartConfiguration<'line'> = {
  type: 'line',
  data: {
    datasets: [],
    labels: [],
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
};

export const impulseChartOptions: ChartConfiguration<'bar'> = {
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
    plugins: {
      legend: {
        labels: {
          usePointStyle: true,
        },
      },
    },
  },
};
