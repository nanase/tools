/** 表示用の音（1 回の打鍵の音圧の波形）を、音と同じ計算でメインスレッドの外で作る（残響なし、モノラル） */
import { type BoardDesc, Engine } from './engine';
import type { StrikeMsg } from './model';

export interface Job {
  id: number;
  board: BoardDesc;
  p: StrikeMsg;
  fs: number;
  /** 長さ [s] */
  dur: number;
}
export interface Reply {
  id: number;
  y: Float32Array;
}

/** 1 回の打鍵の音（呼び出し側で Worker を使えないときにも使う）。鍵は押したまま */
export function renderStrike(j: Job): Float32Array {
  const e = new Engine(j.fs),
    y = new Float32Array(Math.round(j.dur * j.fs));
  e.setBoard(j.board);
  e.strike(j.p);
  for (let i = 0; i < y.length; i += 128) e.render(y, i, Math.min(128, y.length - i));
  return y;
}

/* Worker の中でだけ受け付ける（メインスレッドで renderStrike を使うときは何もしない） */
if (typeof document === 'undefined')
  self.onmessage = (e: MessageEvent<Job>) => {
    const y = renderStrike(e.data);
    postMessage({ id: e.data.id, y } satisfies Reply, { transfer: [y.buffer] });
  };
