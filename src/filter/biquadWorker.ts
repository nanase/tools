import { BiquadFilter } from '@/lib/filter/biquadFilter';
import type { WorkerParameter, WorkerResult } from './biquadWorkerType';
import { findMinMax } from '@nanase/alnilam/array';

self.addEventListener('message', (event: MessageEvent<WorkerParameter>) => {
  console.info(`[biquadWorker] start impulseLength: ${event.data.impulseLength}`);
  const result = preciseCalc(event.data);
  console.info(`[biquadWorker] finish impulseLength: ${event.data.impulseLength}`);
  self.postMessage(result);
});

function preciseCalc(params: WorkerParameter): WorkerResult {
  const preciseBiquadFilter = new BiquadFilter(params.impulseLength);
  preciseBiquadFilter.setFilter(params.filterType, params.samplingFreq, params.cutoffFreq, {
    q: params.q,
    gain: params.gain,
  });
  preciseBiquadFilter.transform();
  const minMax = findMinMax(preciseBiquadFilter.frequencyResponse);

  return {
    magnitudeOnCutoff:
      (preciseBiquadFilter.frequencyResponse[
        Math.floor((params.cutoffFreq / params.samplingFreq) * params.impulseLength)
      ] +
        preciseBiquadFilter.frequencyResponse[
          Math.floor((params.cutoffFreq / params.samplingFreq) * params.impulseLength + 1)
        ]) /
      2,
    maxMagnitude: minMax.max,
    minMagnitude: minMax.min,
    maxMagnitudeFrequency: (params.samplingFreq / params.impulseLength) * minMax.maxIndex,
    minMagnitudeFrequency: (params.samplingFreq / params.impulseLength) * minMax.minIndex,
    sumImpulse: preciseBiquadFilter.impluseResponse.reduce((p, c) => p + c, 0.0),
  };
}

export default {};
