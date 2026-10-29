import { describe, expect, it } from 'vitest';
import {
  area,
  at,
  cconv,
  conv,
  corr,
  dft,
  flip,
  moments,
  pow2,
  type Sig,
  shape,
  sig,
  slide,
  spectrum,
  sumOf,
} from '../src/tools/convolution/conv';
import {
  binom1,
  conv2,
  conv2sep,
  gauss1,
  type Img,
  kernel,
  ksum,
  outer,
  separate,
  terms,
} from '../src/tools/convolution/image';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(tol);
};

describe('離散の畳み込みの和（Smith 6 章・7 章）', () => {
  const x = sig(0, 1, [0, -1, -1.2, 2, 1.4, 1.4, 0.8, 0, -0.8]),
    h = sig(0, 1, [1, -0.5, -0.3, -0.2]);
  it('長さは N + M − 1、値は式 6-1 の和', () => {
    const y = conv(x, h);
    expect(y.v.length).toBe(9 + 4 - 1);
    for (let i = 0; i < y.v.length; i++) {
      let s = 0;
      for (let j = 0; j < 4; j++) if (i - j >= 0 && i - j < 9) s += h.v[j] * x.v[i - j];
      expect(y.v[i]).toBeCloseTo(s, 12);
    }
  });
  it('デルタ関数は恒等（式 7-1）、ずらしたデルタは信号をずらす（式 7-3）', () => {
    close(conv(x, sig(0, 1, [1])).v, x.v, 1e-12);
    const y = conv(x, sig(3, 1, [1]));
    expect(y.t0).toBe(3);
    close(y.v, x.v, 1e-12);
  });
  it('交換・結合・分配の法則（式 7-6〜7-8）', () => {
    const c = sig(0, 1, [0.3, 0.7, -0.4]);
    close(conv(x, h).v, conv(h, x).v, 1e-12);
    close(conv(conv(x, h), c).v, conv(x, conv(h, c)).v, 1e-12);
    const hc = sig(0, 1, [1.3, 0.2, -0.7, -0.2]);
    const a = conv(x, h).v,
      b = conv(x, sig(0, 1, [0.3, 0.7, -0.4, 0])).v,
      s = conv(x, hc).v;
    for (let i = 0; i < s.length; i++) expect(s[i]).toBeCloseTo(a[i] + b[i], 12);
  });
  it('出力の和は入力の和と核の和の積', () => {
    expect(area(conv(x, h))).toBeCloseTo(area(x) * area(h), 12);
  });
  it('滑らせた位置の積の和が出力の 1 点になる', () => {
    const y = conv(x, h);
    for (let n = 0; n < y.v.length; n++) expect(slide(x, h, n).area).toBeCloseTo(y.v[n], 12);
  });
  it('相関は核を裏返した畳み込み（Goodfellow ほか 9.1 節の式 9.6）', () => {
    const r = corr(x, h);
    /* r[n] = Σ_m x[n + m] h[m] */
    for (let i = 0; i < r.v.length; i++) {
      const n = r.t0 + i;
      let s = 0;
      for (let m = 0; m < 4; m++) if (n + m >= 0 && n + m < 9) s += x.v[n + m] * h.v[m];
      expect(r.v[i]).toBeCloseTo(s, 12);
    }
    expect(flip(flip(h)).t0).toBeCloseTo(0, 12);
  });
});

describe('確率の分布の和（Grinstead・Snell 7 章）', () => {
  const die = shape('dice', 0, 0, 7, 1);
  it('2 個のサイコロの和は 1/36, 2/36, …, 6/36, …, 1/36（例 7.1）', () => {
    const s2 = sumOf(die, 2);
    const want = [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((k) => k / 36);
    for (let n = 2; n <= 12; n++) expect(at(s2, n)).toBeCloseTo(want[n - 2], 12);
    expect(at(s2, 1)).toBe(0);
  });
  it('3 個のサイコロで P(S3 = 3) = 1/216（例 7.1 の続き）', () => {
    expect(at(sumOf(die, 3), 3)).toBeCloseTo(1 / 216, 12);
  });
  it('n 個の和の平均と分散は n 倍（3.5n と 35n/12）', () => {
    const m = moments(sumOf(die, 5));
    expect(m.mean).toBeCloseTo(17.5, 10);
    expect(m.vari).toBeCloseTo((35 * 5) / 12, 10);
  });
  const dt = 1e-3;
  it('[0, 1] の一様分布 2 つの和は三角形 z・2 − z（例 7.3）', () => {
    const u = shape('rect', 1, 0, 1000, dt);
    const z = conv(u, u);
    for (const t of [0.25, 0.5, 0.9, 1.3, 1.75]) expect(at(z, t)).toBeCloseTo(t <= 1 ? t : 2 - t, 2);
  });
  it('指数分布 2 つの和は λ² z e^(−λz)（例 7.4）', () => {
    const lam = 2,
      e = shape('exp', 1 / lam, 0, 8000, dt);
    for (let i = 0; i < e.v.length; i++) e.v[i] *= lam;
    const z = conv(e, e);
    for (const t of [0.2, 0.5, 1, 2]) expect(at(z, t)).toBeCloseTo(lam * lam * t * Math.exp(-lam * t), 2);
  });
  it('正規分布どうしの和は分散が足される正規分布（例 7.5）', () => {
    const g1 = shape('gauss', 0.5, -4, 8001, dt, true),
      g2 = shape('gauss', 1.2, -6, 12001, dt, true);
    const z = conv(g1, g2),
      m = moments(z);
    expect(m.mean).toBeCloseTo(0, 6);
    expect(m.vari).toBeCloseTo(0.25 + 1.44, 4);
    const s = Math.sqrt(0.25 + 1.44);
    expect(at(z, 0)).toBeCloseTo(1 / (s * Math.sqrt(2 * Math.PI)), 4);
  });
});

describe('畳み込み定理（Smith 9 章・18 章、JOS MDFT）', () => {
  const x = [1, 2, -1, 0.5, 3],
    h = [0.5, -0.25, 1];
  it('円状畳み込みの DFT は DFT の積', () => {
    const L = 8,
      y = cconv(x, h, L),
      X = dft(x, L),
      H = dft(h, L),
      Y = dft(y, L);
    for (let k = 0; k < L; k++) {
      expect(Y.re[k]).toBeCloseTo(X.re[k] * H.re[k] - X.im[k] * H.im[k], 10);
      expect(Y.im[k]).toBeCloseTo(X.re[k] * H.im[k] + X.im[k] * H.re[k], 10);
    }
  });
  it('L ≥ N + M − 1 まで 0 で埋めれば円状畳み込みは直線の畳み込みと同じ', () => {
    const lin = conv(sig(0, 1, x), sig(0, 1, h)).v;
    close(cconv(x, h, pow2(lin.length)).subarray(0, lin.length), lin, 1e-12);
  });
  it('L が短いと、はみ出した分が頭に回って足される', () => {
    const lin = conv(sig(0, 1, x), sig(0, 1, h)).v,
      c = cconv(x, h, 4);
    for (let n = 0; n < 4; n++) expect(c[n]).toBeCloseTo(lin[n] + (lin[n + 4] ?? 0), 12);
  });
  it('連続の信号でも |Y(f)| = |X(f)|·|H(f)|', () => {
    const dt = 0.01,
      a: Sig = shape('rect', 1, 0, 100, dt),
      b: Sig = shape('exp', 0.3, 0, 300, dt),
      y = conv(a, b),
      L = pow2(y.v.length),
      X = spectrum(a, L),
      H = spectrum(b, L),
      Y = spectrum(y, L);
    for (let k = 0; k < 40; k++) expect(Y[k]).toBeCloseTo(X[k] * H[k], 10);
    /* 幅 1 の矩形の変換は |sin(πf) / (πf)|（bin k の周波数は k / (L dt)） */
    for (const k of [1, 2, 3, 7]) {
      const f = k / (L * dt);
      expect(X[k]).toBeCloseTo(Math.abs(Math.sin(Math.PI * f) / (Math.PI * f)), 2);
    }
  });
});

/* ---------- 2 次元 ---------- */
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
