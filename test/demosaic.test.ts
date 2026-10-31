import { describe, expect, it } from 'vitest';
import { CHART_H, CHART_W, makeChart } from '../src/tools/demosaic/chart';
import {
  ahdSteps,
  blur,
  cfaColor,
  DIRS,
  demosaic,
  haDirections,
  METHODS,
  type Method,
  MHC,
  medianChroma,
  mhcKernel,
  mosaic,
  newRgb,
  PATTERNS,
  type Rgb,
  reflect,
  score,
  srgbToLab,
  vngPixel,
} from '../src/tools/demosaic/demosaic';

const img = (w: number, h: number, f: (x: number, y: number) => [number, number, number]): Rgb => {
  const o = newRgb(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y),
        i = y * w + x;
      o.r[i] = r;
      o.g[i] = g;
      o.b[i] = b;
    }
  return o;
};
const maxDiff = (a: Rgb, b: Rgb) => {
  let m = 0;
  for (const k of ['r', 'g', 'b'] as const)
    for (let i = 0; i < a[k].length; i++) m = Math.max(m, Math.abs(a[k][i] - b[k][i]));
  return m;
};

describe('ベイヤー配列とモザイク', () => {
  it('RGGB の 2 × 2 は R G / G B で、2 画素ごとにくり返す', () => {
    expect([cfaColor('RGGB', 0, 0), cfaColor('RGGB', 1, 0), cfaColor('RGGB', 0, 1), cfaColor('RGGB', 1, 1)]).toEqual([
      0, 1, 1, 2,
    ]);
    expect(cfaColor('RGGB', 4, 6)).toBe(0);
    expect(cfaColor('BGGR', 0, 0)).toBe(2);
    expect(cfaColor('GRBG', 1, 0)).toBe(0);
  });
  it('どの並びでも G は半分、R・B は 4 分の 1', () => {
    for (const p of PATTERNS) {
      const n = [0, 0, 0];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) n[cfaColor(p, x, y)]++;
      expect(n).toEqual([4, 8, 4]);
    }
  });
  it('モザイクは画素ごとにフィルタの色の値だけを残す', () => {
    const im = img(6, 4, (x, y) => [x / 10, y / 10, 0.9]);
    const m = mosaic(im, 'RGGB');
    expect(m.v[0]).toBeCloseTo(0, 6);
    /* (1, 0) は G で y / 10、(0, 1) も G、(1, 1) は B */
    expect(m.v[1]).toBeCloseTo(0, 6);
    expect(m.v[6]).toBeCloseTo(0.1, 6);
    expect(m.v[6 + 1]).toBeCloseTo(0.9, 6);
  });
  it('端の外は端の画素を軸に折り返し、色の並びの偶奇を保つ', () => {
    expect(reflect(-1, 8)).toBe(1);
    expect(reflect(-2, 8)).toBe(2);
    expect(reflect(8, 8)).toBe(6);
    expect(reflect(9, 8)).toBe(5);
    for (const i of [-3, -2, -1, 8, 9, 10]) expect(Math.abs(reflect(i, 8) - i) % 2).toBe(0);
  });
});

describe('どの手法でも成り立つこと', () => {
  const gray = img(20, 16, (x, y) => {
    const a = 0.2 + 0.02 * x + 0.015 * y;
    return [a, a, a];
  });
  const flat = img(12, 10, () => [0.7, 0.3, 0.2]);
  for (const method of METHODS)
    for (const pat of PATTERNS) {
      it(`${method}・${pat}: 一様な色の画像は元に戻る`, () => {
        expect(maxDiff(demosaic(mosaic(flat, pat), method), flat)).toBeLessThan(1e-6);
      });
      it(`${method}・${pat}: 測った色の値はそのまま残る`, () => {
        const im = makeChart();
        const m = mosaic(im, pat),
          o = demosaic(m, method),
          p = [o.r, o.g, o.b];
        for (let i = 0; i < m.v.length; i += 37) expect(p[m.c[i]][i]).toBeCloseTo(m.v[i], 6);
      });
    }
  for (const method of ['bilinear', 'mhc', 'ha', 'vng', 'ahd'] as Method[])
    it(`${method}: 灰色の 1 次の傾斜は端を除いて元に戻る`, () => {
      const o = demosaic(mosaic(gray, 'RGGB'), method);
      for (let y = 4; y < 12; y++)
        for (let x = 4; x < 16; x++) {
          const i = y * 20 + x;
          expect(Math.abs(o.r[i] - gray.r[i])).toBeLessThan(1e-5);
          expect(Math.abs(o.g[i] - gray.g[i])).toBeLessThan(1e-5);
          expect(Math.abs(o.b[i] - gray.b[i])).toBeLessThan(1e-5);
        }
    });
});

describe('手法ごとの式', () => {
  it('Malvar-He-Cutler の係数は和が 8（直流の利得 1）で、左右と上下は互いに転置', () => {
    for (const k of Object.values(MHC)) expect(k.reduce((a, b) => a + b, 0)).toBeCloseTo(8, 9);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) expect(MHC.row[y * 5 + x]).toBe(MHC.col[x * 5 + y]);
  });
  it('MHC の係数の選び方: R の画素の G は g、B は diag、G の画素は隣の色の向き', () => {
    const m = mosaic(newRgb(4, 4), 'RGGB');
    expect(mhcKernel(m, 0, 0, 1)).toBe('g');
    expect(mhcKernel(m, 0, 0, 2)).toBe('diag');
    expect(mhcKernel(m, 0, 0, 0)).toBeNull();
    /* (1, 0) は R の行の G。R は左右、B は上下 */
    expect(mhcKernel(m, 1, 0, 0)).toBe('row');
    expect(mhcKernel(m, 1, 0, 2)).toBe('col');
  });
  it('Hamilton-Adams は縦の縞では縦に、横の縞では横に補間する', () => {
    const vs = img(16, 16, (x) => (x % 4 < 2 ? [0.9, 0.9, 0.9] : [0.1, 0.1, 0.1]));
    const hs = img(16, 16, (_x, y) => (y % 4 < 2 ? [0.9, 0.9, 0.9] : [0.1, 0.1, 0.1]));
    expect(haDirections(mosaic(vs, 'RGGB'))[8 * 16 + 8]).toBe(2);
    expect(haDirections(mosaic(hs, 'RGGB'))[8 * 16 + 8]).toBe(1);
  });
  it('Hamilton-Adams・AHD は縦縞をほぼ正しく戻し、バイリニアより誤差が小さい', () => {
    const vs = img(32, 32, (x) => (x % 4 < 2 ? [0.9, 0.9, 0.9] : [0.1, 0.1, 0.1]));
    const m = mosaic(vs, 'RGGB');
    const s = (k: Method) => score(vs, demosaic(m, k)).cpsnr;
    expect(s('ha')).toBeGreaterThan(s('bilinear') + 10);
    expect(s('ahd')).toBeGreaterThan(s('bilinear') + 10);
  });
  it('VNG は 8 方向の勾配と閾値 T = 1.5 最小 + 0.5（最大 − 最小）で方向を選ぶ', () => {
    const vs = img(16, 16, (x) => (x < 8 ? [0.9, 0.9, 0.9] : [0.1, 0.1, 0.1]));
    const info = vngPixel(mosaic(vs, 'RGGB'), 6, 6);
    const mn = Math.min(...info.grad),
      mx = Math.max(...info.grad);
    expect(info.t).toBeCloseTo(1.5 * mn + 0.5 * (mx - mn), 9);
    const names = info.sel.map((d) => DIRS[d][0]);
    /* 縦の縁の手前では上下に沿う方向が選ばれ、縁をまたぐ東は選ばれない */
    expect(names).toContain('N');
    expect(names).toContain('S');
    expect(names).not.toContain('E');
  });
  it('一様な所では VNG は 8 方向すべてを使う', () => {
    const info = vngPixel(
      mosaic(
        img(10, 10, () => [0.4, 0.5, 0.6]),
        'RGGB',
      ),
      5,
      5,
    );
    expect(info.sel.length).toBe(8);
  });
  it('AHD は縦の縞の上で縦、横の縞の上で横を選ぶ', () => {
    const vs = img(16, 16, (x) => (x % 4 < 2 ? [0.9, 0.2, 0.2] : [0.1, 0.1, 0.6]));
    const hs = img(16, 16, (_x, y) => (y % 4 < 2 ? [0.9, 0.2, 0.2] : [0.1, 0.1, 0.6]));
    expect(ahdSteps(mosaic(vs, 'RGGB')).dir[8 * 16 + 8]).toBe(2);
    expect(ahdSteps(mosaic(hs, 'RGGB')).dir[8 * 16 + 8]).toBe(1);
  });
  it('色差のメディアンは測った色の値を残す', () => {
    const im = makeChart();
    const m = mosaic(im, 'RGGB'),
      o = medianChroma(m, demosaic(m, 'bilinear'), 2),
      p = [o.r, o.g, o.b];
    for (let i = 0; i < m.v.length; i += 41) expect(p[m.c[i]][i]).toBeCloseTo(m.v[i], 6);
  });
});

describe('テスト画像での順位', () => {
  const im = makeChart();
  const m = mosaic(im, 'RGGB');
  const s = Object.fromEntries(METHODS.map((k) => [k, score(im, demosaic(m, k)).cpsnr])) as Record<Method, number>;
  it('テスト画像は 384 × 256', () => {
    expect([im.w, im.h]).toEqual([CHART_W, CHART_H]);
  });
  it('最近傍 < バイリニア < MHC、勾配を見る手法はバイリニアより良い', () => {
    expect(s.nearest).toBeLessThan(s.bilinear);
    expect(s.bilinear).toBeLessThan(s.mhc);
    expect(s.ha).toBeGreaterThan(s.bilinear);
    expect(s.vng).toBeGreaterThan(s.bilinear);
    expect(s.ahd).toBeGreaterThan(s.bilinear);
  });
  it('光学ローパスフィルタを入れるとバイリニアの誤差（元の画像との差）が減る', () => {
    const lp = blur(im, 0.6);
    const a = score(lp, demosaic(mosaic(lp, 'RGGB'), 'bilinear')).cpsnr;
    expect(a).toBeGreaterThan(s.bilinear);
  });
});

describe('誤差の指標', () => {
  it('同じ画像なら PSNR は無限大、ΔE は 0', () => {
    const im = makeChart();
    const r = score(im, im);
    expect(r.cpsnr).toBe(Infinity);
    expect(r.de).toBe(0);
  });
  it('どの色も 0.1 ずれると PSNR は 20 dB', () => {
    const a = img(16, 16, () => [0.5, 0.5, 0.5]),
      b = img(16, 16, () => [0.6, 0.6, 0.6]);
    const r = score(a, b, 0);
    expect(r.cpsnr).toBeCloseTo(20, 4);
    expect(r.psnr[1]).toBeCloseTo(20, 4);
  });
  it('CIELAB: 白は L* = 100、黒は 0、灰色は a* = b* = 0', () => {
    expect(srgbToLab(1, 1, 1)[0]).toBeCloseTo(100, 2);
    expect(srgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 6);
    const g = srgbToLab(0.5, 0.5, 0.5);
    expect(Math.abs(g[1])).toBeLessThan(0.01);
    expect(Math.abs(g[2])).toBeLessThan(0.01);
  });
});
