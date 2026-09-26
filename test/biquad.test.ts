import { describe, expect, it } from 'vitest';
import { formatter, resolve } from '../src/lib/param-core';
import { analyze, coef, type FilterType, fft } from '../src/tools/biquad/filter';
import { fcList, fcPatch, PARAMS, sup, TYPES } from '../src/tools/biquad/params';
import { fixed, frIndex, frPlot, impPlot, lvX, trace } from '../src/tools/biquad/plot';

const S2 = Math.SQRT1_2;

/* 期待値は画面案（旧 legacy/lib/filter/biquadFilter.ts と legacy/lib/fft.ts の移植）で求めたもの */
const MOCK: [FilterType, number, number, number, number, number, Record<string, number>][] = [
  [
    'lowpass',
    48e3,
    1e3,
    S2,
    6,
    1024,
    { aFc: -3.080964114194754, max: 0, maxF: 0, min: -147.86477356985574, minF: 23953.125, sum: 1 },
  ],
  [
    'highpass',
    44100,
    200,
    2,
    0,
    4096,
    { aFc: 5.929977533149367, max: 6.298060690863714, maxF: 215.33203125, min: -253.40543709520787, minF: 0, sum: 0 },
  ],
  [
    'bandpass',
    48e3,
    1e3,
    4,
    0,
    1024,
    {
      aFc: -0.16292458955257225,
      max: -0.06878150885001595,
      maxF: 984.375,
      min: -158.60992600420255,
      minF: 0,
      sum: 1.1735556747124462e-8,
    },
  ],
  [
    'bandstop',
    48e3,
    5e3,
    1,
    0,
    2048,
    { aFc: -46.46646381586336, max: 0, maxF: 0, min: -49.46802162966904, minF: 4992.1875, sum: 1 },
  ],
  [
    'lowshelf',
    48e3,
    300,
    S2,
    -6,
    1024,
    { aFc: -2.9291296909271884, max: 0, maxF: 23953.125, min: -6.000000000004495, minF: 0, sum: 0.5011872336270136 },
  ],
  [
    'highshelf',
    96e3,
    8e3,
    1,
    9,
    1024,
    { aFc: 4.529923552607713, max: 9.62848999827749, maxF: 15562.5, min: -0.6284470496939119, minF: 3937.5, sum: 1 },
  ],
  [
    'peaking',
    48e3,
    1e3,
    2,
    6,
    1024,
    { aFc: 5.938578763317743, max: 5.9742326506707535, maxF: 984.375, min: 0, minF: 0, sum: 1 },
  ],
];

describe('係数（Audio EQ Cookbook）', () => {
  it('LPF: 画面案と同じ値', () => {
    const c = coef('lowpass', 48e3, 1e3, S2, 0);
    const want = [
      0.004277569313094809, 0.008555138626189618, 0.004277569313094809, 1.0922959556412573, -1.9828897227476208,
      0.9077040443587427,
    ];
    c.forEach((x, i) => {
      expect(x).toBeCloseTo(want[i], 15);
    });
  });

  it('HSF: 画面案と同じ値', () => {
    const c = coef('highshelf', 96e3, 8e3, 1, 9);
    const want = [
      6.571693254794715, -10.068514113757782, 4.3964892207751936, 2.73878584299598, -3.282216626662814,
      1.443099145478961,
    ];
    c.forEach((x, i) => {
      expect(x).toBeCloseTo(want[i], 12);
    });
  });

  it('APF は分子と分母が逆順、BSF は b0 = b2 = 1', () => {
    const c = coef('allpass', 48e3, 1e3, S2, 0);
    expect(c[0]).toBe(c[5]);
    expect(c[2]).toBe(c[3]);
    const n = coef('bandstop', 48e3, 1e3, 1, 0);
    expect([n[0], n[2]]).toEqual([1, 1]);
    expect(n[1]).toBe(n[4]);
  });

  it('増幅量を使わない種類は G に依らない', () => {
    for (const t of TYPES.filter((x) => !x.g))
      expect(coef(t.v, 48e3, 1e3, 1, 12)).toEqual(coef(t.v, 48e3, 1e3, 1, -12));
  });

  it('G = 0 dB のシェルフとピーキングは素通し（b = a）', () => {
    for (const t of ['lowshelf', 'highshelf', 'peaking'] as const) {
      const c = coef(t, 48e3, 1e3, 1, 0);
      for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(c[i + 3], 12);
    }
  });
});

describe('FFT', () => {
  it('素朴な DFT と一致する', () => {
    const N = 64,
      x = Array.from({ length: N }, (_, i) => Math.sin(i * 0.7) + ((i * 37) % 11) / 11);
    const re = Float64Array.from(x),
      im = new Float64Array(N);
    fft(re, im);
    for (let k = 0; k < N; k++) {
      let r = 0,
        s = 0;
      for (let n = 0; n < N; n++) {
        r += x[n] * Math.cos((2 * Math.PI * k * n) / N);
        s -= x[n] * Math.sin((2 * Math.PI * k * n) / N);
      }
      expect(re[k]).toBeCloseTo(r, 10);
      expect(im[k]).toBeCloseTo(s, 10);
    }
  });

  it('長さが 2 の累乗でなければ例外', () => {
    expect(() => fft(new Float64Array(12), new Float64Array(12))).toThrow(RangeError);
  });
});

describe('解析（インパルス応答の FFT）', () => {
  it.each(MOCK)('%s: 要約値は画面案と同じ', (t, fs, fc, q, g, N, w) => {
    const r = analyze({ t, fs, fc, q, g }, N, false);
    expect(r.aFc).toBeCloseTo(w.aFc, 9);
    expect(r.max).toBeCloseTo(w.max, 9);
    expect(r.min).toBeCloseTo(w.min, 6);
    expect(r.maxF).toBe(w.maxF);
    expect(r.minF).toBe(w.minF);
    expect(r.sum).toBeCloseTo(w.sum, 9);
  });

  it('curves なら応答・振幅・位相の列も返す（長さ N と N/2）', () => {
    const r = analyze({ t: 'lowpass', fs: 48e3, fc: 1e3, q: S2, g: 0 }, 1024, true);
    expect(r.h.length).toBe(1024);
    expect(r.mag.length).toBe(512);
    expect(r.ph.length).toBe(512);
    expect(r.h[0]).toBeCloseTo(0.003916126660547383, 15);
    expect(r.nb[0]).toBeCloseTo(r.co[0] / r.co[3], 15);
    expect(r.nb[3]).toBeCloseTo(-r.co[4] / r.co[3], 15);
    /* 直流で 0 dB、位相 0° */
    expect(r.mag[0]).toBeCloseTo(0, 9);
    expect(r.ph[0]).toBeCloseTo(0, 9);
  });

  it('APF の振幅は全域で 0 dB', () => {
    const r = analyze({ t: 'allpass', fs: 48e3, fc: 1e3, q: S2, g: 0 }, 1024, true);
    for (const m of r.mag) expect(Math.abs(m)).toBeLessThan(1e-9);
  });
});

describe('入力の定義', () => {
  it('fc の並びは 1 Hz から fs/2 未満の R10', () => {
    const L = fcList(48e3);
    expect(L[0]).toBe(1);
    expect(L.slice(0, 10)).toEqual([1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8]);
    expect(L.at(-1)).toBe(20000);
    expect(fcList(44100).at(-1)).toBe(20000);
    expect(fcList(1000).at(-1)).toBe(400);
  });

  it('fc は fs/2 未満に直す（画面案の言い回し）', () => {
    const p = fcPatch(48e3);
    expect(p.fix?.(30e3)).toEqual([20000, 'fs/2 = 24 kHz 未満にするため 20 kHz にしました']);
    expect(p.fix?.(0.5)).toEqual([1, '500 mHz は範囲外のため下限 1 Hz にしました']);
    expect(p.fix?.(1500)).toEqual([1500, '']);
    expect(p.sub).toBe('fs/2 = 24 kHz 未満');
    expect(fcPatch(44100).sub).toBe('fs/2 = 22.05 kHz 未満');
  });

  it('範囲外は「… は範囲外のため上限 … にしました」、並びにない点数は吸着', () => {
    const def = (k: string) => {
      const d = PARAMS.find((x) => x.k === k);
      if (!d) throw new Error(k);
      return d;
    };
    const q = def('q');
    expect(resolve(q, [], formatter(q), 200).why).toBe('200 は範囲外のため上限 128 にしました');
    const g = def('g');
    expect(resolve(g, [], formatter(g), -50)).toEqual({ w: -40, why: '−50 dB は範囲外のため下限 −40 dB にしました' });
    const n = def('n'),
      L = [256, 512, 1024, 2048];
    expect(resolve(n, L, formatter(n), 1000)).toEqual({ w: 1024, why: '1000 は選べないため 1024 にしました' });
  });

  it('表記: fs は 5 桁、G は符号つき、点数は 2 の累乗', () => {
    const f = (k: string) => {
      const d = PARAMS.find((x) => x.k === k);
      if (!d) throw new Error(k);
      return formatter(d);
    };
    expect(f('fs').input(44100)).toBe('44.1 k');
    expect(f('fs').step(22050)).toBe('22.05k');
    expect(f('fs').text(22050)).toBe('22.05 kHz');
    expect(f('g').input(-6)).toBe('−6');
    expect(f('g').step(3)).toBe('+3');
    expect(f('q').input(Math.SQRT1_2)).toBe('0.7071');
    expect(f('np').step(2 ** 20)).toBe('2²⁰');
    expect(f('n').step(32768)).toBe('32768');
    expect(sup(24)).toBe('²⁴');
  });
});

describe('表示窓', () => {
  it('fixed: −0 と非有限の表記', () => {
    expect(fixed(-0.0001, 3)).toBe('0.000');
    expect(fixed(-1.5, 2)).toBe('−1.50');
    expect(fixed(-Infinity, 2)).toBe('−∞');
    expect(fixed(NaN, 2)).toBe('—');
  });

  it('trace: 同じ px の点は最初・最小・最大・最後だけ残す', () => {
    const v = [0, 5, 1, 9, 3, 7];
    expect(
      trace(
        6,
        () => 10,
        (k) => v[k],
        (y) => y,
        false,
      ),
    ).toBe('M10.0 5.0L10.0 1.0L10.0 9.0L10.0 7.0');
    /* 位相の折り返しで線を切る */
    const p = [0, 170, 179, -179, -170];
    expect(
      trace(
        5,
        (k) => k * 10,
        (k) => p[k],
        (y) => y,
        true,
      ),
    ).toBe('M10.0 170.0L20.0 179.0M30.0 -179.0L40.0 -170.0');
  });

  it('周波数特性: 下端 −60 dB で最大 0 dB なら 12 dB/div、横軸は fs/N から fs/2', () => {
    const r = analyze({ t: 'lowpass', fs: 48e3, fc: 1e3, q: S2, g: 0 }, 1024, true);
    const f = frPlot({ N: 1024, fs: 48e3, fc: 1e3, mag: r.mag, ph: r.ph, max: r.max, bot: -60 });
    expect(f.dv).toBe(12);
    expect(f.f0).toBe(46.875);
    expect(f.f1).toBe(24000);
    expect(f.X(f.f0)).toBeCloseTo(0, 9);
    expect(f.X(f.f1)).toBeCloseTo(400, 9);
    expect(f.F(200)).toBeCloseTo(Math.sqrt(46.875 * 24000), 6);
    expect(f.fcLine).toBe(`M${f.X(1000).toFixed(1)} 0V240`);
    expect(frIndex(1000, 48e3, 1024)).toBe(21);
    expect(frIndex(1, 48e3, 1024)).toBe(1);
  });

  it('インパルス応答: 画面案と同じ縦軸と 0 の位置', () => {
    const h = (t: FilterType, q: number) => analyze({ t, fs: 48e3, fc: 1e3, q, g: 6 }, 1024, true).h;
    const lp = impPlot(h('lowpass', S2), 1024, 256);
    expect([lp.vd, lp.d, lp.nEnd]).toEqual([0.02, 32, 289]);
    expect(lp.zero).toBe('M0 200H400');
    const hp = impPlot(h('highpass', S2), 1024, 256);
    expect([hp.vd, hp.zero]).toEqual([0.2, 'M0 200H400']);
    const bp = impPlot(h('bandpass', 8), 1024, 1024);
    expect([bp.vd, bp.d, bp.nEnd, bp.zero]).toEqual([0.01, 128, 1024, 'M0 120H400']);
    expect(bp.width).toBe(1);
  });

  it('レベルメーター: −50 dBFS が左端、0 dBFS が右端', () => {
    expect(lvX(-50)).toBe(0);
    expect(lvX(0)).toBe(400);
    expect(lvX(-100)).toBe(0);
    expect(lvX(-25)).toBe(200);
  });
});
