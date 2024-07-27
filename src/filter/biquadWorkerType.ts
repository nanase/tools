import { type BiquadFilterType } from '@/lib/filter/biquadFilter';

export interface WorkerParameter {
  impulseLength: number;
  filterType: BiquadFilterType;
  samplingFreq: number;
  cutoffFreq: number;
  q: number;
  gain: number;
}

export interface WorkerResult {
  magnitudeOnCutoff: number;
  maxMagnitude: number;
  minMagnitude: number;
  maxMagnitudeFrequency: number;
  minMagnitudeFrequency: number;
  sumImpulse: number;
}
