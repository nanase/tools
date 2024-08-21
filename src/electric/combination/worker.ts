import { approximate, type ApproximateResult } from '@/lib/passiveComponent';
import type {
  InitializeParameter,
  InitializeResult,
  InvokeParameter,
  InvokeResult,
  WorkerParameter,
} from './workerType';

let approxIterator: Generator<ApproximateResult, void> | null = null;

self.addEventListener('message', (event: MessageEvent<WorkerParameter>) => {
  switch (event.data.type) {
    case 'initialize': {
      self.postMessage(initialize(event.data));
      break;
    }

    case 'invoke': {
      self.postMessage(invoke(event.data));
      break;
    }
  }
});

function initialize(parameter: InitializeParameter): InitializeResult {
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

  console.info(`[worker] initialized`);
  return { type: 'initialize' };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function invoke(parameter: InvokeParameter): InvokeResult {
  if (!approxIterator) {
    return {
      type: 'invoke',
      done: false,
    };
  }

  const iterationResult = approxIterator.next();

  return {
    type: 'invoke',
    done: iterationResult.done ?? false,
    result: iterationResult.value
      ? {
          componentNodes: iterationResult.value.combination?.componentNodes,
          total: iterationResult.value.total,
          current: iterationResult.value.current,
        }
      : undefined,
  };
}
