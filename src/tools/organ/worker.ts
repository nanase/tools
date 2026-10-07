/** 表示用の音（1 つの鍵の管の音圧の波形）を、音と同じ計算でメインスレッドの外で作る（残響なし、モノラル） */
import { Engine, type PipeMsg, type WindDesc } from './engine';

export interface Job {
  id: number;
  pipes: PipeMsg[];
  wind: WindDesc;
  fs: number;
  /** 長さ [s] と、弁を閉じる時刻 [s] */
  dur: number;
  offAt: number;
}
export interface Reply {
  id: number;
  y: Float32Array;
}

/** 1 つの鍵の音（呼び出し側で Worker を使えないときにも使う） */
export function renderKey(j: Job): Float32Array {
  const e = new Engine(j.fs),
    y = new Float32Array(Math.round(j.dur * j.fs)),
    nOff = Math.round(j.offAt * j.fs);
  e.setWind(j.wind);
  for (const p of j.pipes) e.on(p);
  for (let i = 0; i < y.length; i += 128) {
    if (i >= nOff && i < nOff + 128) for (const p of j.pipes) e.off(p.id);
    e.render(y, i, Math.min(128, y.length - i));
  }
  return y;
}

if (typeof document === 'undefined')
  self.onmessage = (e: MessageEvent<Job>) => {
    const y = renderKey(e.data);
    postMessage({ id: e.data.id, y } satisfies Reply, { transfer: [y.buffer] });
  };
