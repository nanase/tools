import { describe, expect, it } from 'vitest';
import { formatter, resolve } from '../src/lib/param-core';
import { freqResp, iirMults, iirOrder, magAt, measure, roots } from '../src/tools/fir/analysis';
import { design, fitN, type Method, remezTaps, run, type Spec, specBands, windowTaps } from '../src/tools/fir/design';
import { coefStr, coefText } from '../src/tools/fir/export';
import { leastSquares } from '../src/tools/fir/ls';
import { nList, PARAMS } from '../src/tools/fir/params';
import { type FrIn, frPlot, irPlot, stepDiv, zPlot } from '../src/tools/fir/plot';
import { remez, solveCos, trimExt, type WBand } from '../src/tools/fir/remez';
import { apOf, bandsOf, dpOf, dsOf, fitHz, type Resp, rangesHz, validHz } from '../src/tools/fir/spec';
import { besselI0, idealOf, kaiserBeta, kaiserOrder, windowDesign, windowOf } from '../src/tools/fir/window';

const SPEC: Spec = {
  t: 'lowpass',
  fs: 48e3,
  f1: 6000,
  f2: 12000,
  df: 3000,
  ap: 0.1,
  as: 60,
  method: 'window',
  win: 'kaiser',
  auto: true,
  n: 51,
  beta: 5,
  wp: 1,
  ws: 10,
};
const TYPES: Resp[] = ['lowpass', 'highpass', 'bandpass', 'bandstop'];
const METHODS: Method[] = ['window', 'remez', 'ls'];

/** 対称 h の振幅関数 A(f) = Σ h[n] cos(2πf(n − M)) */
const amp = (h: Float64Array, f: number): number => {
  const M = (h.length - 1) / 2;
  let s = 0;
  h.forEach((v, n) => {
    s += v * Math.cos(2 * Math.PI * f * (n - M));
  });
  return s;
};

describe('窓関数', () => {
  it('ハミング窓（O&S の定義）: 両端 0.08、中央 1', () => {
    const w = windowOf('hamming', 5);
    [0.08, 0.54, 1, 0.54, 0.08].forEach((v, i) => {
      expect(w[i]).toBeCloseTo(v, 15);
    });
  });

  it('ハン窓・ブラックマン窓は N + 2 点の両端を除く（0 の係数を作らない）', () => {
    expect(Array.from(windowOf('hann', 3))).toEqual([0.5, 1, 0.5].map((v) => expect.closeTo(v, 15)));
    expect(Array.from(windowOf('blackman', 3))).toEqual([0.34, 1, 0.34].map((v) => expect.closeTo(v, 15)));
    for (const w of ['hann', 'blackman'] as const) expect(Math.min(...windowOf(w, 31))).toBeGreaterThan(0);
  });

  it('カイザー窓: 中央 1、両端 1/I0(β)、β = 0 は矩形窓', () => {
    const w = windowOf('kaiser', 21, 5.653);
    expect(w[10]).toBeCloseTo(1, 15);
    expect(w[0]).toBeCloseTo(1 / besselI0(5.653), 15);
    expect(Array.from(windowOf('kaiser', 9, 0))).toEqual(Array(9).fill(1));
  });

  it('I0 は数表（Abramowitz & Stegun）の値', () => {
    expect(besselI0(0)).toBe(1);
    expect(besselI0(1)).toBeCloseTo(1.2660658777520082, 14);
    expect(besselI0(5)).toBeCloseTo(27.239871823604442, 12);
  });

  it('窓はすべて左右対称', () => {
    for (const w of ['rect', 'hann', 'hamming', 'blackman', 'kaiser'] as const)
      for (const N of [8, 9]) {
        const x = windowOf(w, N, 4);
        for (let n = 0; n < N; n++) expect(x[n]).toBe(x[N - 1 - n]);
      }
  });
});

describe('Kaiser の式', () => {
  it('O&S の例: δ = 0.001（A = 60 dB）、Δω = 0.2π で β = 5.653、M = 37', () => {
    expect(kaiserBeta(60)).toBeCloseTo(5.65326, 10);
    expect(Math.ceil(kaiserOrder(60, 0.2 * Math.PI))).toBe(37);
  });

  it('β の 3 つの区間', () => {
    expect(kaiserBeta(40)).toBeCloseTo(0.5842 * 19 ** 0.4 + 0.07886 * 19, 12);
    expect(kaiserBeta(21)).toBe(0);
    expect(kaiserBeta(15)).toBe(0);
  });

  it('仕様から: O&S の例と同じ仕様（ωp = 0.4π、ωs = 0.6π、δ1 = 0.01、δ2 = 0.001）で N = 38', () => {
    const s: Spec = { ...SPEC, fs: 1, f1: 0.25, df: 0.1, ap: apOf(0.01), as: 60 };
    expect(windowTaps(s)).toBe(38);
    const d = design(s);
    expect(d.N).toBe(38);
    expect(d.beta).toBeCloseTo(5.65326, 10);
  });
});

describe('窓関数法', () => {
  it('理想ローパス（ωc = π/2）を矩形窓で 7 点に切ると sin(πm/2)/(πm)', () => {
    const { h } = windowDesign('lowpass', 7, 0.25, 0, 'rect', 0);
    const want = [-1 / (3 * Math.PI), 0, 1 / Math.PI, 0.5, 1 / Math.PI, 0, -1 / (3 * Math.PI)];
    want.forEach((v, i) => {
      expect(h[i]).toBeCloseTo(v, 15);
    });
    /* 0 になるはずの係数は丸め誤差を残さない */
    expect(h[1]).toBe(0);
  });

  it('HPF・BSF は 1 から LPF・BPF を引いたもの（N が奇数）', () => {
    const lp = idealOf('lowpass', 11, 0.2, 0),
      hp = idealOf('highpass', 11, 0.2, 0),
      bp = idealOf('bandpass', 11, 0.1, 0.3),
      bs = idealOf('bandstop', 11, 0.1, 0.3);
    for (let n = 0; n < 11; n++) {
      expect(hp[n] + lp[n]).toBeCloseTo(n === 5 ? 1 : 0, 15);
      expect(bs[n] + bp[n]).toBeCloseTo(n === 5 ? 1 : 0, 15);
    }
  });

  it('ハミング窓のタップ数は Δf·N = 3.3 から、阻止域端で約 53 dB', () => {
    const s: Spec = { ...SPEC, win: 'hamming', df: 2000 };
    expect(windowTaps(s)).toBe(80);
    const r = run(s);
    expect(r.m.atten).toBeGreaterThan(51);
    expect(r.m.atten).toBeLessThan(55);
  });
});

describe('直線位相', () => {
  it.each(TYPES)('%s: どの設計法でも係数は左右対称（h[n] = h[N − 1 − n]）', (t) => {
    for (const method of METHODS)
      for (const auto of [true, false]) {
        const d = design({ ...SPEC, t, method, auto, n: 40 });
        const pk = Math.max(...d.h.map(Math.abs));
        for (let n = 0; n < d.N; n++) expect(Math.abs(d.h[n] - d.h[d.N - 1 - n])).toBeLessThanOrEqual(pk * 1e-15);
      }
  });

  it('HPF・BSF は奇数のタップ数（偶数を指定しても 1 つ増やす）', () => {
    expect(fitN('highpass', 40)).toBe(41);
    expect(fitN('bandstop', 1024)).toBe(1023);
    expect(fitN('lowpass', 40)).toBe(40);
    expect(design({ ...SPEC, t: 'highpass', auto: false, n: 40 }).N).toBe(41);
    expect(nList(true).every((n) => n % 2 === 1)).toBe(true);
  });

  it('群遅延はどの周波数でも (N − 1)/2', () => {
    for (const N of [31, 32]) {
      const d = design({ ...SPEC, method: 'remez', auto: false, n: N, wp: 1, ws: 10 });
      const fr = freqResp(d.h);
      let n = 0;
      fr.gd.forEach((g, k) => {
        if (!Number.isFinite(g)) return;
        /* 通過域では丸め誤差の程度、阻止域の零点の近くでも 1/1000 サンプル以内 */
        expect(Math.abs(g - (N - 1) / 2)).toBeLessThan(fr.mag[k] > 0.5 ? 1e-9 : 1e-3);
        n++;
      });
      expect(n).toBeGreaterThan(fr.gd.length * 0.99);
    }
  });

  it('位相は通過域で −ω(N − 1)/2 の直線（つないだ値）', () => {
    const r = run(SPEC),
      M = (r.d.N - 1) / 2,
      { L, ph } = r.fr;
    /* 通過域（0 … 4.5 kHz）の点 */
    for (const k of [0, 100, 500, 1000, 1500]) expect(ph[k]).toBeCloseTo((-360 * M * k) / L, 6);
  });
});

describe('等リップル（Parks–McClellan）', () => {
  /* O&S の例: ωp = 0.4π、ωs = 0.6π、K = δ1/δ2 = 10 */
  const B: WBand[] = [
    { lo: 0, hi: 0.2, d: 1, w: 1 },
    { lo: 0.3, hi: 0.5, d: 0, w: 10 },
  ];

  it('O&S の例: M = 26 で δ2 = 0.00116、M = 27 で δ2 = 0.00092', () => {
    expect(remez(27, B).delta / 10).toBeCloseTo(0.00116, 5);
    expect(remez(28, B).delta / 10).toBeCloseTo(0.00092, 5);
  });

  it('O&S の式 (7.117) によるタップ数の目安は M = 26', () => {
    const s: Spec = { ...SPEC, method: 'remez', fs: 1, f1: 0.25, df: 0.1, ap: apOf(0.01), as: 60 };
    expect(remezTaps(s)).toBe(27);
    /* 仕様（δ2 = 0.001）を満たす最小は M = 27 */
    expect(design(s).N).toBe(28);
  });

  it.each([27, 28, 61])('N = %i: 重み付き誤差の最大は δ で、r + 1 個の極値で ±δ を交互にとる', (N) => {
    const r = remez(N, B),
      err = (f: number) => (f <= 0.2 ? 1 - amp(r.h, f) : -10 * amp(r.h, f)),
      R = N % 2 ? (N + 1) / 2 : N / 2;
    expect(r.converged).toBe(true);
    expect(r.ext.length).toBe(R + 1);
    let mx = 0;
    for (let i = 0; i <= 20000; i++) {
      const f = (0.5 * i) / 20000;
      if (f <= 0.2 || f >= 0.3) mx = Math.max(mx, Math.abs(err(f)));
    }
    expect(mx).toBeLessThanOrEqual(r.delta * (1 + 1e-6));
    const e = Array.from(r.ext, err);
    e.forEach((v, j) => {
      expect(Math.abs(v)).toBeCloseTo(r.delta, 9);
      if (j) expect(Math.sign(v)).toBe(-Math.sign(e[j - 1]));
    });
  });

  it('長いフィルタでも等リップル（N = 401、Δf = 1/48、δ ≈ 7.6 × 10⁻⁷）', () => {
    const r = remez(401, [
      { lo: 0, hi: 5500 / 48000, d: 1, w: 1 },
      { lo: 6500 / 48000, hi: 0.5, d: 0, w: 10 },
    ]);
    expect(r.converged).toBe(true);
    expect(r.delta).toBeGreaterThan(7e-7);
    expect(r.delta).toBeLessThan(8e-7);
    const m = measure(r.h, freqResp(r.h), bandsOf('lowpass', 6000 / 48000, 0, 1000 / 48000), 1, 1);
    expect(m.dp).toBeCloseTo(r.delta, 9);
    expect(m.ds).toBeCloseTo(r.delta / 10, 10);
  });

  it('仕様から: 仕様を満たす最小のタップ数（1 つ短いと満たさない）', () => {
    for (const t of TYPES) {
      const s: Spec = { ...SPEC, t, method: 'remez' },
        r = run(s),
        step = t === 'highpass' || t === 'bandstop' ? 2 : 1;
      expect(r.m.dp).toBeLessThanOrEqual(dpOf(s.ap) * (1 + 1e-6));
      expect(r.m.ds).toBeLessThanOrEqual(dsOf(s.as) * (1 + 1e-6));
      const shorter = run({ ...s, auto: false, n: r.d.N - step, wp: 1, ws: r.d.ws });
      expect(shorter.m.dp > dpOf(s.ap) || shorter.m.ds > dsOf(s.as)).toBe(true);
    }
  });

  it('交互の極値を減らしても符号は交互のまま', () => {
    const L = [3, -1, 2, -0.5, 4, -2, 1].map((e) => ({ e }));
    const t = trimExt(L, 4);
    expect(t.length).toBe(4);
    t.forEach((c, j) => {
      if (j) expect(Math.sign(c.e)).toBe(-Math.sign(t[j - 1].e));
    });
  });

  it('余弦の係数の連立方程式', () => {
    /* P(ω) = 0.5 + 0.25 cos ω − 0.125 cos 2ω を 3 点で */
    const x = Float64Array.from([0.9, 0.1, -0.7]),
      c = x.map((v) => 0.5 + 0.25 * v - 0.125 * (2 * v * v - 1));
    const a = solveCos(x, c);
    [0.5, 0.25, -0.125].forEach((v, i) => {
      expect(a[i]).toBeCloseTo(v, 14);
    });
  });
});

describe('最小二乗法', () => {
  it('遷移帯域がなく重みが等しければ、矩形窓で切った理想の応答と同じ', () => {
    for (const N of [21, 22]) {
      const h = leastSquares(N, [
          { lo: 0, hi: 0.2, d: 1, w: 1 },
          { lo: 0.2, hi: 0.5, d: 0, w: 1 },
        ]),
        w = windowDesign('lowpass', N, 0.2, 0, 'rect', 0).h;
      for (let n = 0; n < N; n++) expect(h[n]).toBeCloseTo(w[n], 12);
    }
  });

  it('仕様から求めると仕様を満たす', () => {
    const r = run({ ...SPEC, method: 'ls' });
    expect(r.m.dp).toBeLessThanOrEqual(dpOf(SPEC.ap) * (1 + 1e-6));
    expect(r.m.atten).toBeGreaterThanOrEqual(60 - 1e-6);
  });
});

describe('仕様と実際の値', () => {
  it('Ap・As と δp・δs', () => {
    expect(dsOf(60)).toBeCloseTo(0.001, 15);
    expect(dpOf(0.1)).toBeCloseTo(0.005756, 6);
    expect(apOf(dpOf(0.37))).toBeCloseTo(0.37, 12);
  });

  it('帯域: LPF は通過・阻止、BSF は通過・阻止・通過', () => {
    expect(bandsOf('lowpass', 0.25, 0, 0.1)).toEqual([
      { lo: 0, hi: 0.2, pass: true },
      { lo: 0.3, hi: 0.5, pass: false },
    ]);
    expect(bandsOf('bandstop', 0.2, 0.3, 0.02).map((b) => b.pass)).toEqual([true, false, true]);
  });

  it('等リップルの実際のリップル・減衰は δ から求めた値と同じ', () => {
    const r = run({ ...SPEC, method: 'remez', auto: false, n: 47, wp: 1, ws: 10 }),
      d = r.d.delta ?? 0;
    expect(r.m.ripple).toBeCloseTo(apOf(d), 8);
    expect(r.m.atten).toBeCloseTo(-20 * Math.log10(d / 10), 5);
    /* 遷移帯域幅は仕様（3 kHz）とほぼ同じ */
    expect(r.m.trans * 48e3).toBeLessThanOrEqual(3000);
    expect(r.m.trans * 48e3).toBeGreaterThan(2950);
  });

  it('|H| を 1 点で求める', () => {
    const h = Float64Array.from([0.25, 0.5, 0.25]);
    expect(magAt(h, 0)).toBeCloseTo(1, 15);
    expect(magAt(h, 0.5)).toBeCloseTo(0, 15);
    expect(magAt(h, 0.25)).toBeCloseTo(0.5, 15);
  });

  it('帯域を作れない値は直す（df を縮めるか、fc を fs/2 の内側へ）', () => {
    expect(validHz('lowpass', 48e3, { f1: 6000, f2: 0, df: 3000 })).toBe(true);
    const a = fitHz('lowpass', 48e3, { f1: 1000, f2: 0, df: 3000 });
    expect(a.fixed).toEqual(['df']);
    expect(validHz('lowpass', 48e3, a.v)).toBe(true);
    const b = fitHz('bandpass', 8000, { f1: 6000, f2: 12000, df: 1000 });
    expect(b.fixed).toContain('f1');
    expect(validHz('bandpass', 8000, b.v)).toBe(true);
    const r = rangesHz('bandpass', 48e3, { f1: 6000, f2: 12000, df: 2000 });
    expect(r.f1[1]).toBeCloseTo(10000 - 4.8, 6);
    expect(r.df[1]).toBeCloseTo(6000 - 4.8, 6);
  });
});

describe('同じ仕様の IIR フィルタ', () => {
  it('MATLAB の ellipord・buttord の例（fs = 1 kHz、0 … 40 Hz で 3 dB、150 Hz から 60 dB）: 楕円 4 次、バタワース 5 次', () => {
    const o = iirOrder('lowpass', 95 / 1000, 0, 110 / 1000, 3, 60);
    expect(o.ellip).toBe(4);
    expect(o.butter).toBe(5);
  });

  it('BPF・BSF は低域の原型の 2 倍、乗算は双2次の段 5 回・1 次の段 3 回', () => {
    expect(iirOrder('bandpass', 0.1, 0.3, 0.02, 1, 60).ellip % 2).toBe(0);
    expect(iirMults(6)).toBe(15);
    expect(iirMults(7)).toBe(18);
  });
});

describe('零点', () => {
  it('2 次式の根', () => {
    const a = roots([1, -2, 1]);
    for (let i = 0; i < 2; i++) {
      expect(a.re[i]).toBeCloseTo(1, 6);
      expect(a.im[i]).toBeCloseTo(0, 6);
    }
    const b = roots([1, 0, 1]),
      im = Array.from(b.im).sort((p, q) => p - q);
    expect(im[0]).toBeCloseTo(-1, 12);
    expect(im[1]).toBeCloseTo(1, 12);
    /* 末尾の 0 は z = 0 の根 */
    expect(Array.from(roots([1, -1, 0]).re).sort()).toEqual([expect.closeTo(0, 12), expect.closeTo(1, 12)]);
  });

  it('直線位相のフィルタの零点は z と 1/z̄ の組、阻止域の零点は単位円の上', () => {
    const r = run({ ...SPEC, method: 'remez' }),
      { re, im } = r.z;
    expect(re.length).toBe(r.d.N - 1);
    let on = 0;
    for (let i = 0; i < re.length; i++) {
      const m = re[i] ** 2 + im[i] ** 2,
        /* 1/z̄ = z/|z|² */
        rr = re[i] / m,
        ri = im[i] / m;
      let best = Infinity;
      for (let j = 0; j < re.length; j++) best = Math.min(best, Math.hypot(re[j] - rr, im[j] - ri));
      expect(best).toBeLessThan(1e-6);
      if (Math.abs(Math.sqrt(m) - 1) < 1e-6) on++;
    }
    expect(on).toBeGreaterThan(re.length / 2);
  });
});

describe('入力の定義', () => {
  const def = (k: string) => {
    const d = PARAMS.find((x) => x.k === k);
    if (!d) throw new Error(k);
    return d;
  };

  it('範囲外は「… は範囲外のため上限 … にしました」、タップ数は並びに吸着', () => {
    const as = def('as');
    expect(resolve(as, [], formatter(as), 200)).toEqual({ w: 150, why: '200 dB は範囲外のため上限 150 dB にしました' });
    const n = def('n');
    expect(resolve(n, nList(true), formatter(n), 60).w % 2).toBe(1);
  });

  it('表記: dB は 4 桁、周波数は SI 接頭辞', () => {
    expect(formatter(def('ap')).input(0.005)).toBe('0.005');
    expect(formatter(def('df')).input(3000)).toBe('3 k');
    expect(formatter(def('df')).step(3150)).toBe('3.15k');
  });
});

describe('係数の書き出し', () => {
  it('倍精度は 17 桁、単精度は 9 桁（C では f を付ける）、0 は 0.0', () => {
    expect(coefStr(0.1, 'f64')).toBe('1.0000000000000001e-1');
    expect(Number(coefStr(Math.PI, 'f64'))).toBe(Math.PI);
    expect(coefStr(0.1, 'f32', true)).toBe('1.00000001e-1f');
    expect(coefStr(0, 'f32', true)).toBe('0.0f');
    expect(coefStr(-0.25, 'f64')).toBe('-2.5000000000000000e-1');
  });

  it('C の配列: 要素数・区切り・宣言', () => {
    const d = design(SPEC),
      c = coefText(SPEC, d, 'c', 'f64'),
      lines = c.trim().split('\n');
    expect(lines[1]).toBe(`#define FIR_N ${d.N}`);
    expect(lines[2]).toBe('static const double fir_h[FIR_N] = {');
    expect(lines.at(-1)).toBe('};');
    expect(lines.filter((l) => l.startsWith('\t')).length).toBe(d.N);
    expect(lines.at(-2)?.endsWith(',')).toBe(false);
    expect(coefText(SPEC, d, 'txt', 'f64').trim().split('\n').map(Number)).toEqual(Array.from(d.h));
  });
});

describe('表示窓', () => {
  it('周波数特性: 横軸は 0 … fs/2、dB の縦軸は阻止域の深さ + 10 dB が入る刻み', () => {
    const r = run(SPEC),
      p: FrIn = {
        fr: r.fr,
        fs: 48e3,
        bands: specBands(SPEC),
        dp: dpOf(0.1),
        ds: dsOf(60),
        ymode: 'db',
        ch2: 'ph',
        M: (r.d.N - 1) / 2,
        depth: 60,
        pmax: r.m.passMax,
        pmin: r.m.passMin,
      },
      f = frPlot(p);
    expect(f.X(0)).toBe(0);
    expect(f.X(0.5)).toBe(400);
    expect(f.dv1).toBe('15 dB');
    /* 0 dB は上から 1 div */
    expect(f.Ym(1)).toBeCloseTo(40, 9);
    /* 仕様の枠: 通過域の端 4.5 kHz、阻止域の端 7.5 kHz に縦線 */
    expect(f.mask).toContain('M75.0 40.1V280');
    expect(f.mask).toContain('M125.0 200.0V-40');
    /* 線形の縦軸は 0 … 1.2（下端の目盛りに丸め誤差を出さない） */
    const l = frPlot({ ...p, ymode: 'lin' });
    expect(l.dv1).toBe('0.2');
    expect(l.axes).toContain('>0</text>');
    expect(l.axes).not.toContain('e-');
  });

  it('インパルス応答: 1 div のサンプル数と中心の線', () => {
    expect(stepDiv(58 / 8.5)).toBe(8);
    expect(stepDiv(0.5)).toBe(1);
    expect(stepDiv(120)).toBe(200);
    const p = irPlot(new Float64Array([0.1, 0.5, 0.1]));
    expect(p.center).toBe('M80.0 0V160');
  });

  it('z 平面: 零点がすべて入る半径（1 div = R/5）', () => {
    const z = { re: Float64Array.from([1, 0.5]), im: Float64Array.from([0, 0]) };
    expect(zPlot(z, 2).R).toBe(1.25);
    expect(zPlot({ re: Float64Array.from([2]), im: Float64Array.from([0]) }, 1).R).toBe(2.5);
    const far = zPlot({ re: Float64Array.from([9, 1]), im: Float64Array.from([0, 0]) }, 2);
    expect([far.R, far.out, far.on]).toEqual([5, 1, 1]);
  });
});
