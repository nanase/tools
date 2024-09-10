import { approximate, type ApproximateResult } from '@/lib/passiveComponent';
import type { InitializeParameter, InvokeParameter, WorkerParameter, WorkerResult } from './workerType';

let approxIterator: Generator<ApproximateResult, void> | null = null;
let componentNumber: number;

self.addEventListener('message', (event: MessageEvent<WorkerParameter>) => {
  switch (event.data.type) {
    case 'initialize': {
      initialize(event.data);
      break;
    }

    case 'invoke': {
      self.postMessage(invoke(event.data));
      break;
    }
  }
});

function initialize(parameter: InitializeParameter) {
  approxIterator = approximate(
    parameter.value,
    parameter.componentType,
    parameter.componentNumber,
    parameter.series,
    parameter.minValue,
    parameter.maxValue,
    parameter.excludedValues,
    parameter.progressBeacon,
  );

  componentNumber = parameter.componentNumber;
  console.info(`[worker] initialized`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function invoke(parameter: InvokeParameter): WorkerResult {
  if (!approxIterator) {
    return {
      done: false,
    };
  }

  const iterationResult = approxIterator.next();

  return {
    done: iterationResult.done ?? false,
    result: iterationResult.value
      ? {
          componentNodes: iterationResult.value.combination?.componentNodes,
          componentNumber,
          total: iterationResult.value.total,
          current: iterationResult.value.current,
        }
      : undefined,
  };
}
