/** 衝突の計算をメインスレッドの外で行う。条件が変わったら、メインスレッドがワーカーごと作り直す */
import { createSim, frameBuffers, type SimFrame, type SimInfo, type SimParams, type SimResult } from './sim';

export type Out = { kind: 'info'; info: SimInfo } | { kind: 'frame'; f: SimFrame } | { kind: 'done'; r: SimResult };

const post = (m: Out, tr: Transferable[] = []) => (self as unknown as Worker).postMessage(m, tr);

self.onmessage = (e: MessageEvent<SimParams>) => {
  const s = createSim(e.data);
  post({ kind: 'info', info: s.info });
  const loop = () => {
    const done = s.tick(60, (f) => post({ kind: 'frame', f }, frameBuffers(f)));
    if (done) post({ kind: 'done', r: s.result() });
    else setTimeout(loop, 0);
  };
  loop();
};
