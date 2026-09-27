/** ファイルの包絡線をメインスレッドの外で求める */
import { analyzeFile, type FileEnv } from './dsp';

export interface Job {
  x: Float32Array;
  fs: number;
  /** 手動の搬送波（Hz）。0 なら自動 */
  f: number;
}
export type Reply = FileEnv | null;

self.onmessage = (e: MessageEvent<Job>) => {
  const r: Reply = analyzeFile(e.data.x, e.data.fs, e.data.f);
  postMessage(r, { transfer: r ? [r.env.buffer as ArrayBuffer, r.pw.buffer as ArrayBuffer] : [] });
};
