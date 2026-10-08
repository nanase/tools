/** 設計と解析（等リップルの反復、タップ数の探索、零点）をメインスレッドの外で行う */
import { type Result, run, type Spec } from './design';

export interface Job {
  id: number;
  s: Spec;
}
export interface Reply {
  id: number;
  r: Result | null;
}

/** 結果の配列（受け渡しで写さずに移す） */
const buffers = (r: Result): ArrayBuffer[] =>
  [r.d.h, r.d.hd, r.d.w, r.fr.mag, r.fr.ph, r.fr.gd, r.z.re, r.z.im]
    .filter((a): a is Float64Array<ArrayBuffer> => !!a)
    .map((a) => a.buffer);

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, s } = e.data;
  let r: Result | null = null;
  try {
    r = run(s);
  } catch {
    /* 帯域が狭すぎるときなど。呼び出し側で知らせる */
  }
  postMessage({ id, r } satisfies Reply, { transfer: r ? buffers(r) : [] });
};
