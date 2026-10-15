import { describe, expect, it } from 'vitest';
import { bin, seeing } from '../src/tools/focusing-mask/camera';
import { starBands } from '../src/tools/focusing-mask/color';
import { fft2d } from '../src/tools/focusing-mask/fft2';
import { reading, sections } from '../src/tools/focusing-mask/geometry';
import { type Mask, type Scope, transmit } from '../src/tools/focusing-mask/mask';
import { fitBahtinov } from '../src/tools/focusing-mask/measure';
import { alphaFor, type Band, type Img, psf, pupil } from '../src/tools/focusing-mask/optics';

const OPEN: Scope = { obs: 0, vanes: 0, vw: 0 };
const NONE: Mask = { kind: 'none', p: 0.1, th: 0, duty: 0.5, bar: 0, rot: 0, holes: 3, hd: 0.3, hr: 0.6 };
const mono = (nm: number): Band[] => [{ nm, rgb: [1, 1, 1] }];
const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0);
const peak = (a: Float64Array) => a.reduce((s, v) => Math.max(s, v), 0);

describe('FFT', () => {
  it('2 次元の変換が定義どおりの DFT と一致し、逆変換で戻る', () => {
    const N = 8,
      re = new Float64Array(N * N),
      im = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) {
      re[i] = Math.sin(i * 0.7);
      im[i] = Math.cos(i * 1.3);
    }
    const r0 = re.slice(),
      i0 = im.slice();
    fft2d(N, re, im);
    for (const [u, v] of [
      [0, 0],
      [1, 3],
      [5, 2],
    ]) {
      let sr = 0,
        si = 0;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const a = (-2 * Math.PI * (u * x + v * y)) / N,
            c = Math.cos(a),
            s = Math.sin(a);
          sr += r0[y * N + x] * c - i0[y * N + x] * s;
          si += r0[y * N + x] * s + i0[y * N + x] * c;
        }
      expect(re[v * N + u]).toBeCloseTo(sr, 9);
      expect(im[v * N + u]).toBeCloseTo(si, 9);
    }
    fft2d(N, re, im, true);
    for (let i = 0; i < N * N; i++) {
      expect(re[i]).toBeCloseTo(r0[i], 12);
      expect(im[i]).toBeCloseTo(i0[i], 12);
    }
  });
});

describe('点像', () => {
  const N = 256,
    M = 128,
    D = 100,
    f = 1000,
    alpha = alphaFor(D, 550, 2.2),
    opt = { N, M, alpha };

  it('ピントの合った円形の開口の中心の明るさがエアリーの式 πD²α²/(4λ²) になる', () => {
    const P = pupil(OPEN, NONE, opt, D, 550),
      p = psf({ D, f, dz: 0 }, P, mono(550), opt, 1),
      expect0 = (Math.PI * (D * 1e-3) ** 2 * alpha ** 2) / (4 * 550e-9 ** 2);
    expect(Math.abs(peak(p.g) / expect0 - 1)).toBeLessThan(0.01);
    /* 像の範囲（±M/2 画素 ≈ ±64 λ/D）の外へ出る光は 1 % 未満 */
    expect(sum(p.g)).toBeGreaterThan(0.99);
    expect(sum(p.g)).toBeLessThan(1.001);
  });

  it('ピントをずらすと中心が暗くなり、光の総量は変わらない', () => {
    const P = pupil(OPEN, NONE, opt, D, 550),
      a = psf({ D, f, dz: 0 }, P, mono(550), opt, 1),
      /* W₀₂₀ = Δz / (8N²) = 1.25 µm（約 2.3 波長） */
      b = psf({ D, f, dz: 1000 }, P, mono(550), opt, 1);
    expect(peak(b.g)).toBeLessThan(peak(a.g) * 0.5);
    expect(sum(b.g)).toBeCloseTo(sum(a.g), 2);
  });

  it('色温度 6500 K の星の点像の色はほぼ白', () => {
    const P = pupil(OPEN, NONE, opt, D, 400),
      p = psf({ D, f, dz: 0 }, P, starBands(6500, 16), { ...opt, alpha: alphaFor(D, 400) }, 2),
      [r, g, b] = [sum(p.r), sum(p.g), sum(p.b)];
    expect(r / g).toBeCloseTo(1, 1);
    expect(b / g).toBeCloseTo(1, 1);
  });
});

describe('マスク', () => {
  it('バーティノフマスクは開口の約半分を通す', () => {
    const m: Mask = { ...NONE, kind: 'bahtinov', p: 0.1, th: (20 * Math.PI) / 180 };
    let open = 0,
      all = 0;
    const n = 400,
      px = 2 / n;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = -1 + (i + 0.5) * px,
          y = -1 + (j + 0.5) * px;
        if (x * x + y * y > 1) continue;
        all++;
        open += transmit(x, y, OPEN, m, px);
      }
    expect(open / all).toBeGreaterThan(0.45);
    expect(open / all).toBeLessThan(0.55);
  });

  it('バーティノフの光条のずれはピントのずれに比例し、向きで符号が変わる', () => {
    const D = 200,
      f = 1000,
      N = 512,
      M = 256,
      th = (20 * Math.PI) / 180,
      m: Mask = { ...NONE, kind: 'bahtinov', p: f / 150 / (D / 2), th },
      alpha = alphaFor(D, 400),
      opt = { N, M, alpha },
      P = pupil(OPEN, m, opt, D, 400),
      bands = starBands(5800, 8),
      pxum = alpha * f * 1e3,
      off = (dz: number) => fitBahtinov(psf({ D, f, dz }, P, bands, opt, 4).g, M, 0, th, M * 0.12, M * 0.45, 6).off;
    const a = off(50),
      b = off(-50),
      c = off(100);
    expect(a).toBeCloseTo(-b, 6);
    expect(Math.abs(c / a - 2)).toBeLessThan(0.1);
    /* 幾何光学の式 Δz (D/f) (2/3π) (2 + tan θ) と 10 % 以内で合う */
    const geo = 100 * (D / f) * (2 / (3 * Math.PI)) * (2 + Math.tan(th));
    expect(Math.abs((c * pxum) / geo - 1)).toBeLessThan(0.1);
  });
  it('ピントのずれの符号を変えた像は、元の像を 180° 回したもの', () => {
    const D = 100,
      f = 700,
      N = 256,
      M = 128,
      m: Mask = { ...NONE, kind: 'bahtinov', p: f / 150 / (D / 2), th: (20 * Math.PI) / 180, bar: 0.06 },
      alpha = alphaFor(D, 550, 1.6),
      opt = { N, M, alpha },
      P = pupil(OPEN, m, opt, D, 550),
      a = psf({ D, f, dz: 150 }, P, mono(550), opt, 1).g,
      b = psf({ D, f, dz: -150 }, P, mono(550), opt, 1).g,
      pk = peak(a);
    let worst = 0;
    for (let y = 1; y < M; y++)
      for (let x = 1; x < M; x++) worst = Math.max(worst, Math.abs(a[y * M + x] - b[(M - y) * M + (M - x)]));
    expect(worst / pk).toBeLessThan(1e-9);
  });

  it('格子の 1 次の回折は、センサーの上で λB（B = f/周期）の位置に出る', () => {
    const D = 100,
      f = 700,
      N = 512,
      M = 256,
      m: Mask = { ...NONE, kind: 'bahtinov', p: f / 150 / (D / 2), th: (20 * Math.PI) / 180 },
      alpha = alphaFor(D, 550, 1.1),
      opt = { N, M, alpha },
      P = pupil(OPEN, m, opt, D, 550),
      g = psf({ D, f, dz: 0 }, P, mono(550), opt, 1).g,
      um = alpha * f * 1e3,
      /* 中央の光条（横）の上で、中心から 50〜120 µm の間の最も明るい画素 */
      row = g.subarray((M / 2) * M, (M / 2 + 1) * M);
    let best = 0,
      at = 0;
    for (let x = M / 2 + Math.ceil(50 / um); x < M / 2 + 120 / um; x++)
      if (row[x] > best) {
        best = row[x];
        at = x;
      }
    expect(Math.abs((at - M / 2) * um - 0.55 * 150)).toBeLessThan(um);
  });
  it('区画の重心から求めた光条のずれは、桟のないとき式 (2/3π)(2 + tan θ)Δz/N と一致し、桟で大きくなる', () => {
    const th = (20 * Math.PI) / 180,
      m: Mask = { ...NONE, kind: 'bahtinov', p: 700 / 150 / 50, th },
      simple = ((2 / (3 * Math.PI)) * (2 + Math.tan(th)) * 100) / 7,
      e = (mm: Mask) => reading('bahtinov', sections(OPEN, mm), 100, 700, 100).v[0];
    expect(e(m) / simple).toBeCloseTo(1, 2);
    expect(e({ ...m, bar: 0.06 })).toBeGreaterThan(simple * 1.02);
  });

  it('単色の像から測った光条のずれは、区画の重心の予測と 2 % 以内で合う', () => {
    const D = 100,
      f = 700,
      N = 1024,
      M = 512,
      th = (20 * Math.PI) / 180,
      m: Mask = { ...NONE, kind: 'bahtinov', p: f / 150 / (D / 2), th, bar: 0.06 },
      alpha = alphaFor(D, 550),
      opt = { N, M, alpha },
      g = psf({ D, f, dz: 200 }, pupil(OPEN, m, opt, D, 550), mono(550), opt, 1).g,
      meas = fitBahtinov(g, M, 0, th, 60, 220, 10).off * alpha * f * 1e3,
      geo = reading('bahtinov', sections(OPEN, m), D, f, 200).v[0];
    expect(Math.abs(meas / geo - 1)).toBeLessThan(0.02);
  });

  it('穴の像は −(Δz/f)·c にずれる（焦点の奥では上の穴の像が下に来る）', () => {
    const D = 100,
      f = 700,
      N = 512,
      M = 256,
      h: Mask = { ...NONE, kind: 'hartmann', holes: 1, hd: 0.3, hr: 0.6 },
      alpha = alphaFor(D, 550),
      opt = { N, M, alpha },
      g = psf({ D, f, dz: 400 }, pupil(OPEN, h, opt, D, 550), mono(550), opt, 1).g;
    let s = 0,
      sy = 0;
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++) {
        s += g[j * M + i];
        sy += g[j * M + i] * (M / 2 - j);
      }
    const y = (sy / s) * alpha * f * 1e3,
      geo = (-400 / f) * sections(OPEN, h)[0].c[1] * (D / 2);
    expect(Math.abs(y / geo - 1)).toBeLessThan(0.02);
  });
});

describe('カメラ', () => {
  const img = (n: number, px: number): Img => {
    const a = new Float64Array(n * n);
    a[(n / 2) * n + n / 2] = 1;
    return { n, px, r: a.slice(), g: a.slice(), b: a.slice() };
  };
  it('画素への積分は光の量を保つ', () => {
    const p = img(64, 1),
      c = bin(p, 2.7, 20);
    expect(sum(c.g)).toBeCloseTo(1, 10);
  });
  it('シーイングの畳み込みは光の量を保ち、半値幅が指定のとおり', () => {
    const p = img(64, 1),
      s = seeing(p, 6);
    expect(sum(s.g)).toBeCloseTo(1, 4);
    /* 中心の行で、ピークの半分になる幅 */
    const row = s.g.slice(32 * 64, 33 * 64),
      pk = row[32];
    let w = 0;
    for (let x = 0; x < 64; x++) if (row[x] >= pk / 2) w++;
    expect(w).toBeGreaterThanOrEqual(5);
    expect(w).toBeLessThanOrEqual(7);
  });
});
