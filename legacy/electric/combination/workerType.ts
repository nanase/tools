import { type ComponentType, type ComponentNode } from '@/lib/passiveComponent';

export interface InitializeParameter {
  type: 'initialize';
  value: number;
  componentType: ComponentType;
  componentNumber: number;
  series: number[];
  minValue: number;
  maxValue: number;
  excludedValues?: number[];
  progressBeacon?: number;
}

export interface InvokeParameter {
  type: 'invoke';
}

export type WorkerParameter = InitializeParameter | InvokeParameter;

export interface WorkerResult {
  done: boolean;
  result?: {
    // Note: With WebWoker, the type information of Combination class is
    //       NEVER serialized! So I'll return the result as a pure array (or object).
    componentNodes?: readonly ComponentNode[];
    componentNumber: number;
    total: number;
    current: number;
  };
}
