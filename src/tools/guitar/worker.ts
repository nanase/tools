/** 表示用の音（1 回の撥弦の音圧の波形）を、音と同じ計算でメインスレッドの外で作る */
import { type BodyDesc, Engine, type PluckMsg } from './engine';

export interface Job {
  id: number;
  body: BodyDesc;
  p: PluckMsg;
  /** フレットノイズ（垂直の力に足す） */
  noise: Float32Array | null;
  fs: number;
  /** 長さ [s] */
  dur: number;
}
export interface Reply {
  id: number;
  y: Float32Array;
}

/** 1 回の撥弦の音（呼び出し側で Worker を使えないときにも使う） */
export function renderPluck(j: Job): Float32Array {
  const e = new Engine(j.fs),
    y = new Float32Array(Math.round(j.dur * j.fs));
  e.setBody(j.body);
  if (j.noise) e.noise(j.p.si, j.noise);
  e.pluck(j.p);
  for (let i = 0; i < y.length; i += 128) e.render(y, i, Math.min(128, y.length - i));
  return y;
}

/* Worker の中でだけ受け付ける（メインスレッドで renderPluck を使うときは何もしない） */
if (typeof document === 'undefined')
  self.onmessage = (e: MessageEvent<Job>) => {
    const y = renderPluck(e.data);
    postMessage({ id: e.data.id, y } satisfies Reply, { transfer: [y.buffer] });
  };
