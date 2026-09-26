/** 精密計算（長いインパルス応答の FFT）をメインスレッドの外で行う */
import { analyze, type FilterParams, type Summary } from './filter';

export interface Job {
  id: number;
  p: FilterParams;
  N: number;
}
export interface Reply {
  id: number;
  r: Summary | null;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, p, N } = e.data;
  let r: Summary | null = null;
  try {
    r = analyze(p, N, false);
  } catch {
    /* 大きすぎる N でメモリを確保できないときなど。呼び出し側で知らせる */
  }
  postMessage({ id, r } satisfies Reply);
};
