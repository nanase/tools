import type { Combination, ComponentType, ESeries } from '@/lib/passiveComponent';
import type { SIPrefixSymbol } from '@nanase/alnilam/siPrefix';

export interface ComponentTypeItem {
  title: string;
  value: ComponentType;
  unit: string;
  valueLabel: string;
  prefixSymbols: SIPrefixSymbol[];
}
export const componentTypeItem: ComponentTypeItem[] = [
  {
    title: '抵抗器 (Ω)',
    value: 'resistor',
    unit: 'Ω',
    valueLabel: '抵抗値',
    prefixSymbols: ['G', 'M', 'k', '', 'm', 'μ'],
  },
  {
    title: 'コンデンサ (F)',
    value: 'capacitor',
    unit: 'F',
    valueLabel: '静電容量',
    prefixSymbols: ['', 'm', 'μ', 'n', 'p'],
  },
  {
    title: 'インダクタ (H)',
    value: 'inductor',
    unit: 'H',
    valueLabel: 'インダクタンス',
    prefixSymbols: ['', 'm', 'μ', 'n'],
  },
];

export interface SeriesItem {
  title: string;
  value: keyof typeof ESeries;
}
export const seriesItem: SeriesItem[] = [
  {
    title: 'E1',
    value: 'E1',
  },
  {
    title: 'E3',
    value: 'E3',
  },
  {
    title: 'E6',
    value: 'E6',
  },
  {
    title: 'E12',
    value: 'E12',
  },
  {
    title: 'E24',
    value: 'E24',
  },
  {
    title: 'E48',
    value: 'E48',
  },
  {
    title: 'E96',
    value: 'E96',
  },
  {
    title: 'E192',
    value: 'E192',
  },
];

export interface TargetErrorRateItem {
  title: string;
  value: number | undefined;
}
export const targetErrorRateItems: TargetErrorRateItem[] = [
  {
    title: '< 0.1%',
    value: 0.001,
  },
  {
    title: '< 0.01%',
    value: 0.0001,
  },
  {
    title: '< 0.001%',
    value: 0.00001,
  },
  {
    title: '= 0.0%（正確）',
    value: 0.0,
  },
  {
    title: '全探索',
    value: undefined,
  },
];

export interface ApproxResult {
  componentType: ComponentTypeItem;
  targetComponentValue: number;
  series: number[];
  componentNumber: number;
  minValue: number;
  maxValue: number;
  excludedValues: number[];
  targetErrorRate: TargetErrorRateItem;
  finished?: boolean;
  finishReason?: 'calculating' | 'finishedByUnderErrorRate' | 'finishedAllCombination' | 'aborted' | 'error';
  bestComponentValue?: number;
  resultCombinations?: Combination[];
  totalCombinations?: number;
  currentCombination?: number;
}

export const initialInputProps: Record<
  ComponentType,
  {
    componentTargetValue: number;
    minValue: number;
    maxValue: number;
    excludedValues: number[];
    excludedValuePlaceholder: number;
  }
> = {
  resistor: {
    componentTargetValue: 1234,
    minValue: 10,
    maxValue: 1e6,
    excludedValuePlaceholder: 1e3,
    excludedValues: [],
  },
  capacitor: {
    componentTargetValue: 1.234e-6,
    minValue: 1e-12,
    maxValue: 1,
    excludedValuePlaceholder: 1e-6,
    excludedValues: [],
  },
  inductor: {
    componentTargetValue: 123.4e-6,
    minValue: 1e-9,
    maxValue: 1,
    excludedValuePlaceholder: 10e-6,
    excludedValues: [],
  },
};
