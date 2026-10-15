/** 星の像の計算（波長の帯の一部）をメインスレッドの外で行う */
import { type Part, part } from './engine';

export interface Job {
  id: number;
  p: Part;
}
export interface Reply {
  id: number;
  n: number;
  px: number;
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, p } = e.data,
    img = part(p),
    r = img.r as Float64Array<ArrayBuffer>,
    g = img.g as Float64Array<ArrayBuffer>,
    b = img.b as Float64Array<ArrayBuffer>;
  postMessage({ id, n: img.n, px: img.px, r, g, b } satisfies Reply, { transfer: [r.buffer, g.buffer, b.buffer] });
};
