/** アクションの動きを計算する Worker（1 回 0.3 s ほどかかるので、主スレッドを止めない） */
import type { Reg } from './model';
import { simulate, type TouchKind } from './sim';

export interface SimIn {
  id: number;
  kind: TouchKind;
  reg: Reg;
}

self.onmessage = (e: MessageEvent<SimIn>) => {
  const { id, kind, reg } = e.data;
  const run = simulate(kind, reg);
  (self as unknown as Worker).postMessage({ id, run }, [run.q.buffer, run.fn.buffer, run.force.buffer]);
};
