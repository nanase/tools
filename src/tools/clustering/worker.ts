/** クラスタリングの計算をメインスレッドの外で行う。結果の Run は構造化複製で返す */
import { runLimited } from './algos';
import { type Data, fitTime, type Params, type Run, thin } from './core';

/** 単独の図のコマの数と再生の長さの上限。点が多いと手順が増えるため */
const MAX_FRAMES = 420;
const MAX_MS = 24000;

export interface Job {
  id: number;
  mid: string;
  d: Data;
  p: Params;
  /** コマの数の上限（一覧の小さい図）。0 なら既定の上限 */
  max: number;
}
export interface Out {
  id: number;
  run: Run;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, mid, d, p, max } = e.data,
    out: Out = { id, run: fitTime(thin(runLimited(mid, d, p), max || MAX_FRAMES), MAX_MS) };
  (self as unknown as Worker).postMessage(out);
};
