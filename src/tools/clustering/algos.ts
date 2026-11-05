/** 手法の id と計算の対応。計算の本体は Worker とテストからだけ読む */
import { ari, type Data, type Params, type Run, rng, shuffle } from './core';
import { dbscan, denclue, densityPeaks, hdbscan, meanshift, optics, quickshift } from './density';
import { gmm, vbgmm } from './distribution';
import { affinity, labelProp, louvain, mcl, mstCut, spectral } from './graph';
import { agglomerative, birch, cure, diana } from './hierarchy';
import { methodOf } from './methods';
import { clique, gng, neuralGas, som } from './neural';
import { bisecting, fcm, kernelKmeans, kmeans, kmedians, kmedoids, minibatch, xmeans } from './prototype';

export const ALGOS: Record<string, (d: Data, p: Params) => Run> = {
  kmeans,
  minibatch,
  kmedoids,
  kmedians,
  fcm,
  bisect: bisecting,
  xmeans,
  kernel: kernelKmeans,
  ward: (d, p) => agglomerative(d, p, 'ward'),
  complete: (d, p) => agglomerative(d, p, 'complete'),
  average: (d, p) => agglomerative(d, p, 'average'),
  single: (d, p) => agglomerative(d, p, 'single'),
  diana,
  birch,
  cure,
  dbscan,
  optics,
  hdbscan,
  meanshift,
  quickshift,
  dpeaks: densityPeaks,
  denclue,
  gmm,
  vbgmm,
  spectral,
  affinity,
  mst: mstCut,
  labelprop: labelProp,
  mcl,
  louvain,
  som,
  ng: neuralGas,
  gng,
  clique,
};

/**
 * 点の数の上限を守って計算する。上限より多いときは点を抽出して計算し、残りの点は最も近い抽出点のクラスタへ入れる。
 * lim は呼び出し側の上限（0 なら手法の上限だけ）
 */
export function runLimited(mid: string, d: Data, p: Params, lim = 0): Run {
  const own = methodOf(mid).lim ?? Infinity,
    cap = lim ? Math.min(lim, own) : own;
  if (d.n <= cap) return ALGOS[mid](d, p);
  const n = d.n,
    ix = shuffle(
      Array.from({ length: n }, (_, i) => i),
      rng((p.seed ?? 1) * 101 + 67),
    ).slice(0, cap),
    sub: Data = {
      ...d,
      n: cap,
      x: Float64Array.from(ix, (i) => d.x[i]),
      y: Float64Array.from(ix, (i) => d.y[i]),
      t: Int16Array.from(ix, (i) => d.t[i]),
    },
    r = ALGOS[mid](sub, p),
    labels = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let b = 0,
      v = Infinity;
    for (let q = 0; q < cap; q++) {
      const u = (d.x[i] - sub.x[q]) ** 2 + (d.y[i] - sub.y[q]) ** 2;
      if (u < v) {
        v = u;
        b = q;
      }
    }
    labels[i] = r.labels[b];
  }
  const last = r.frames[r.frames.length - 1],
    frames = [
      ...r.frames,
      {
        st: last.st,
        say: `残り ${(n - cap).toLocaleString('en-US')} 点を最も近い点のクラスタへ`,
        ms: 1200,
        l: labels,
        all: true,
        m: last.m,
        done: last.done,
        pos: last.pos,
        pick: last.pick,
      },
    ],
    seen = new Set<number>();
  let noise = 0;
  for (const v of labels) {
    if (v < 0) noise++;
    else seen.add(v);
  }
  return {
    ...r,
    frames,
    t: [...r.t, r.T + 1200],
    T: r.T + 1200,
    labels,
    subL: r.labels,
    full: d,
    nc: seen.size,
    noise,
    ari: d.none ? null : ari(d.t, labels),
    dist: r.dist + (n - cap) * cap,
  };
}
