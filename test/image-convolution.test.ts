import { describe, expect, it } from 'vitest';
import {
  binom1,
  conv2,
  conv2fft,
  conv2sep,
  extend,
  gauss1,
  type Img,
  kernel,
  kspec,
  ksum,
  median,
  outer,
  separate,
  terms,
} from '../src/tools/image-convolution/image';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(tol);
};

const img = (w: number, h: number, f: (c: number, r: number) => number): Img => {
  const v = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) v[r * w + c] = f(c, r);
  return { w, h, v };
};
const step = img(12, 10, (c) => (c >= 6 ? 1 : 0.2));
const rnd = img(16, 12, (c, r) => (Math.sin(c * 1.7 + r * 0.6) + Math.cos(r * 2.3 - c)) * 0.25 + 0.5);

describe('画像の畳み込み（Smith 24 章）', () => {
  it('デルタ関数の核では画像は変わらない（図 24-4 a）', () => {
    close(conv2(rnd, kernel('id')).v, rnd.v, 1e-7);
  });
  it('エッジ検出の核（図 24-4 c）の和は 0 で、平らな所は 0', () => {
    const k = kernel('edge');
    expect(ksum(k)).toBeCloseTo(0, 7);
    const y = conv2(step, k);
    expect(y.v[5 * 12 + 2]).toBeCloseTo(0, 6);
    expect(y.v[5 * 12 + 6]).toBeGreaterThan(0);
    expect(y.v[5 * 12 + 5]).toBeLessThan(0);
  });
  it('エッジ強調（図 24-4 d）は元の画像と k 倍のエッジ検出の和', () => {
    const k = 2,
      e = conv2(rnd, kernel('edge')),
      s = conv2(rnd, kernel('sharpen', 0, 0, k));
    for (let i = 0; i < s.v.length; i++) expect(s.v[i]).toBeCloseTo(rnd.v[i] + k * e.v[i], 5);
  });
  it('ガウスの核は分離でき、横と縦の 1 次元の畳み込みで同じ結果（式 24-1）', () => {
    const g = gauss1(1.5),
      k = kernel('gauss', 0, 1.5);
    expect(separate(k)).not.toBeNull();
    for (const e of ['zero', 'clamp', 'mirror', 'wrap'] as const)
      close(conv2sep(rnd, g, g, e).v, conv2(rnd, k, e).v, 1e-6);
    expect(separate(kernel('laplace'))).toBeNull();
    expect(separate(kernel('sobelx'))).not.toBeNull();
  });
  it('箱の核の和は 1 で、平らな画像を変えない', () => {
    const k = kernel('box', 5),
      flat = img(9, 9, () => 0.7);
    expect(ksum(k)).toBeCloseTo(1, 6);
    close(conv2(flat, k, 'clamp').v, flat.v, 1e-6);
  });
  it('Sobel の x は右が明るい縦の境目で正、y は下が明るい横の境目で正', () => {
    const gx = conv2(step, kernel('sobelx'));
    expect(gx.v[5 * 12 + 6]).toBeCloseTo(4 * 0.8, 5);
    expect(gx.v[5 * 12 + 2]).toBeCloseTo(0, 6);
    const hz = img(10, 10, (_c, r) => (r >= 5 ? 1 : 0)),
      gy = conv2(hz, kernel('sobely'));
    expect(gy.v[5 * 10 + 4]).toBeCloseTo(4, 5);
  });
  it('ずらす核は画像を核の 1 の向きへ動かす', () => {
    const y = conv2(rnd, kernel('shift'), 'zero');
    for (let r = 0; r < rnd.h; r++)
      for (let c = 2; c < rnd.w; c++) expect(y.v[r * rnd.w + c]).toBeCloseTo(rnd.v[r * rnd.w + c - 2], 7);
  });
  it('相関は核を 180° 回した畳み込み（Goodfellow ほかの式 9.6）', () => {
    const k = { w: 3, h: 3, v: Float32Array.from([1, 2, 0, -1, 0.5, 3, 0, -2, 1]) },
      rot = { w: 3, h: 3, v: Float32Array.from(k.v).reverse() };
    close(conv2(rnd, k, 'mirror', true).v, conv2(rnd, rot, 'mirror').v, 1e-6);
  });
  it('窓の中の積の和は出力の画素', () => {
    const k = kernel('sobelx'),
      y = conv2(rnd, k, 'mirror');
    for (const [r, c] of [
      [0, 0],
      [5, 7],
      [11, 15],
    ])
      expect(terms(rnd, k, r, c, 'mirror').sum).toBeCloseTo(y.v[r * rnd.w + c], 5);
  });
  it('2 項係数の核は和 1 で、分散 n/4 の正規分布に近づく', () => {
    const b = binom1(16);
    expect(b.reduce((a, c) => a + c, 0)).toBeCloseTo(1, 7);
    expect(b[8]).toBeCloseTo(12870 / 65536, 7);
    const s = Math.sqrt(4);
    expect(b[8]).toBeCloseTo(1 / (s * Math.sqrt(2 * Math.PI)), 2);
    expect(outer([1, 2], [3, 4, 5]).v).toEqual(Float32Array.from([3, 4, 5, 6, 8, 10]));
  });
});

describe('ピンぼけ・アンシャープマスク・周波数（Smith 24・25 章）', () => {
  it('ピンぼけの核（円柱、図 24-3 a）は和 1 で、上下左右と 90° 回しても同じ', () => {
    const k = kernel('disk', 7);
    expect(ksum(k)).toBeCloseTo(1, 6);
    for (let j = 0; j < 7; j++)
      for (let i = 0; i < 7; i++) {
        const v = k.v[j * 7 + i];
        expect(k.v[j * 7 + (6 - i)]).toBeCloseTo(v, 7);
        expect(k.v[i * 7 + j]).toBeCloseTo(v, 7);
      }
    expect(k.v[0]).toBe(0);
    expect(separate(k)).toBeNull();
  });
  it('アンシャープマスクの核は x + k·(x − G∗x) と同じ', () => {
    const kk = 1.5,
      s = 1.2,
      g = conv2(rnd, kernel('gauss', 0, s), 'mirror'),
      u = conv2(rnd, kernel('unsharp', 0, s, kk), 'mirror');
    expect(ksum(kernel('unsharp', 0, s, kk))).toBeCloseTo(1, 6);
    for (let i = 0; i < u.v.length; i++) expect(u.v[i]).toBeCloseTo(rnd.v[i] + kk * (rnd.v[i] - g.v[i]), 5);
  });
  it('端の扱いの 4 通り（鏡は端の画素も写す。SciPy の reflect）', () => {
    const x = img(4, 1, (c) => c + 1);
    expect(Array.from(extend(x, 3, 'zero').v.subarray(30, 40))).toEqual([0, 0, 0, 1, 2, 3, 4, 0, 0, 0]);
    expect(Array.from(extend(x, 3, 'clamp').v.subarray(30, 40))).toEqual([1, 1, 1, 1, 2, 3, 4, 4, 4, 4]);
    expect(Array.from(extend(x, 3, 'mirror').v.subarray(30, 40))).toEqual([3, 2, 1, 1, 2, 3, 4, 4, 3, 2]);
    expect(Array.from(extend(x, 3, 'wrap').v.subarray(30, 40))).toEqual([2, 3, 4, 1, 2, 3, 4, 1, 2, 3]);
  });
  it('周波数の積で畳み込むと、端が反対側から回る畳み込みと同じ（24 章 FFT Convolution）', () => {
    const x = img(16, 8, (c, r) => (Math.sin(c * 1.7 + r * 0.6) + Math.cos(r * 2.3 - c)) * 0.25 + 0.5);
    for (const k of [kernel('sobelx'), kernel('gauss', 0, 1), kernel('emboss'), kernel('shift')])
      close(conv2fft(x, k).v, conv2(x, k, 'wrap').v, 1e-6);
  });
  it('核の周波数特性: 和が 1 なら中央が 1、和が 0 なら中央が 0。ガウスの MTF はガウス（図 25-1）', () => {
    const n = 64,
      c = (n / 2) * n + n / 2;
    expect(kspec(kernel('box', 5), n)[c]).toBeCloseTo(1, 6);
    expect(kspec(kernel('laplace'), n)[c]).toBeCloseTo(0, 6);
    const s = 1.5,
      g = kspec(kernel('gauss', 0, s), n);
    /* 横に 8 升 = 1/8 周期/画素 */
    expect(g[c + 8]).toBeCloseTo(Math.exp(-2 * Math.PI ** 2 * s * s * (1 / 8) ** 2), 2);
  });
  it('メディアンは孤立した点を消すが、足し算を保たない（畳み込みではない）', () => {
    const a = img(7, 7, (c, r) => (c === 3 && r === 3 ? 1 : 0.2)),
      m = median(a, 3);
    expect(m.v[3 * 7 + 3]).toBeCloseTo(0.2, 6);
    const p = img(3, 1, (c) => [0, 1, 0][c]),
      q = img(3, 1, (c) => [1, 0, 0][c]),
      pq = img(3, 1, (c) => [1, 1, 0][c]);
    const sum = median(p, 3).v[1] + median(q, 3).v[1];
    expect(median(pq, 3).v[1]).not.toBeCloseTo(sum, 3);
  });
});
