/** 星の像の計算（波長の帯の一部・カメラの画素への積分・光源との畳み込み）をメインスレッドの外で行う */
import { bin, seeing } from './camera';
import { type Part, part } from './engine';
import type { Img } from './optics';
import { convolve, type Plane, sample } from './source';

/** 依頼: 点像の帯の一部、点像のカメラの画素への積分とシーイング、光源の 1 色分と核の畳み込み */
export type Msg =
  | { t: 'psf'; p: Part }
  | { t: 'exp'; img: Img; px: number; n: number; see: number }
  | { t: 'conv'; p: Plane; K: Float64Array; nk: number; R: number };
export interface Job {
  id: number;
  i: number;
  m: Msg;
}
export interface Reply {
  id: number;
  i: number;
  out: Img | Float64Array;
}

const imgOut = (id: number, i: number, img: Img) => {
  const r = img.r as Float64Array<ArrayBuffer>,
    g = img.g as Float64Array<ArrayBuffer>,
    b = img.b as Float64Array<ArrayBuffer>;
  postMessage({ id, i, out: { n: img.n, px: img.px, r, g, b } } satisfies Reply, {
    transfer: [r.buffer, g.buffer, b.buffer],
  });
};

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, i, m } = e.data;
  if (m.t === 'psf') imgOut(id, i, part(m.p));
  else if (m.t === 'exp') imgOut(id, i, seeing(bin(m.img, m.px, m.n), m.see));
  else {
    const o = convolve(sample(m.p, m.R + m.nk), m.K, m.nk, m.R) as Float64Array<ArrayBuffer>;
    postMessage({ id, i, out: o } satisfies Reply, { transfer: [o.buffer] });
  }
};
