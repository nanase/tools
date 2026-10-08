import { describe, expect, it } from 'vitest';
import { formatter, resolve } from '../src/lib/param-core';
import {
  A3,
  attenAt,
  bessel,
  besselDelay,
  besselPoly,
  butter,
  cheby1,
  cheby2,
  ellip,
  type Kind,
  minOrder,
} from '../src/tools/iir/analog';
import { abs, type C } from '../src/tools/iir/complex';
import { design, metrics, type Spec } from '../src/tools/iir/design';
import {
  analogTime,
  impinv,
  impulseBA,
  impulsePF,
  impulseSOS,
  pfToBA,
  prewarp,
  quantize,
  respBA,
  respPF,
  respS,
  respSOS,
  respZ,
  toBA,
  toSOS,
  unwarp,
  zRoots,
} from '../src/tools/iir/digital';
import { acdeR, asneR, cdeR, comp, ellipdeg, ellipK, ellipKp, sneR } from '../src/tools/iir/elliptic';
import { edgeChain, edgeDefaults, edgeLabel, edgePatch, PARAMS, RESPS } from '../src/tools/iir/params';
import { freqAxis, pzPlot, sRange, timePlot } from '../src/tools/iir/plot';
import { fromRoots, isStable, roots } from '../src/tools/iir/poly';

const sortC = (rs: readonly C[]) =>
  [...rs].sort((a, b) => Math.round(a.re * 1e9) - Math.round(b.re * 1e9) || a.im - b.im);
const near = (rs: readonly C[], want: readonly [number, number][], d: number) => {
  const a = sortC(rs),
    b = [...want].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  expect(a.length).toBe(b.length);
  a.forEach((r, i) => {
    expect(r.re).toBeCloseTo(b[i][0], d);
    expect(r.im).toBeCloseTo(b[i][1], d);
  });
};
/** 仕様の既定値（MATLAB の例: fs = 1 kHz） */
const SPEC: Spec = {
  kind: 'butter',
  resp: 'lp',
  mode: 'spec',
  n: 4,
  f1: 40,
  f2: 200,
  s1: 150,
  s2: 250,
  ap: 3,
  as: 60,
  fs: 1000,
};

describe('楕円関数と完全楕円積分（Orfanidis の Landen 変換）', () => {
  it('K(0) = π/2、K(1/√2) はレムニスケートの値 Γ(1/4)²/(4√π)', () => {
    expect(ellipK(0)).toBe(Math.PI / 2);
    expect(ellipK(Math.SQRT1_2)).toBeCloseTo(1.8540746773013719, 14);
    /* K(sin 15°)・K(sin 75°) の比は √3（特異値 k₃） */
    const k = Math.sin(Math.PI / 12);
    expect(ellipKp(k) / ellipK(k)).toBeCloseTo(Math.sqrt(3), 13);
  });

  it('母数が 1 に近くても K′ = K(k′) が漸近形 ln(4/k′) に合う', () => {
    const kp = 1e-9,
      k = comp(kp);
    expect(ellipK(k, kp)).toBeCloseTo(Math.log(4 / kp), 8);
  });

  it('sn と cd: sn(K) = 1、cd(0) = 1、cd(u) = sn(u + K)、逆関数', () => {
    for (const k of [0.1, 0.5, 0.9, 0.999]) {
      expect(sneR(1, k)).toBeCloseTo(1, 14);
      expect(cdeR(0, k)).toBeCloseTo(1, 14);
      for (const u of [0.1, 0.37, 0.8]) {
        expect(cdeR(u, k)).toBeCloseTo(sneR(u + 1, k), 13);
        expect(asneR(sneR(u, k), k)).toBeCloseTo(u, 10);
        expect(acdeR(cdeR(u, k), k)).toBeCloseTo(u, 10);
      }
    }
  });

  it('ellipdeg の k は次数の式 N·K′(k)/K(k) = K′(k₁)/K(k₁) を満たす', () => {
    for (const [N, k1] of [
      [3, 0.01],
      [4, 1e-3],
      [7, 1e-5],
    ]) {
      const [k, kp] = ellipdeg(N, k1);
      expect((N * ellipKp(k, kp)) / ellipK(k, kp)).toBeCloseTo(ellipKp(k1) / ellipK(k1), 9);
    }
  });
});

describe('アナログの原型', () => {
  it('楕円 N = 4・Ap = 1 dB・As = 20 dB の零点・極・ゲイン（Altair Compose の ellipap の例と同じ）', () => {
    const f = ellip(4, 1, 20);
    near(
      f.z,
      [
        [0, 1.12431],
        [0, -1.12431],
        [0, 2.03909],
        [0, -2.03909],
      ],
      5,
    );
    near(
      f.p,
      [
        [-0.05161, 1.00365],
        [-0.05161, -1.00365],
        [-0.40028, 0.6509],
        [-0.40028, -0.6509],
      ],
      5,
    );
    expect(f.k).toBeCloseTo(0.1, 12);
    /* 通過域端で Ap、阻止域端 1/k で As、直流は偶数次なので −Ap */
    expect(attenAt(f, 1)).toBeCloseTo(1, 10);
    expect(attenAt(f, 1 / f.ks)).toBeCloseTo(20, 9);
    expect(attenAt(f, 1e-9)).toBeCloseTo(1, 10);
  });

  it('楕円の奇数次は実数の極を 1 つ持ち、直流で 0 dB', () => {
    const f = ellip(5, 0.5, 60);
    expect(f.p.filter((p) => p.im === 0)).toHaveLength(1);
    expect(f.z).toHaveLength(4);
    expect(attenAt(f, 1e-9)).toBeCloseTo(0, 10);
    expect(attenAt(f, 1)).toBeCloseTo(0.5, 10);
  });

  it('バターワース: 極は半径 1 の円の上（Ω = 1 で −3.01 dB）', () => {
    const f = butter(6);
    for (const p of f.p) expect(abs(p)).toBeCloseTo(1, 14);
    expect(attenAt(f, 1)).toBeCloseTo(A3, 12);
  });

  it('チェビシェフ I 0.5 dB の 2 次の極は −0.7128 ± j1.0040（表の値）、リップルは Ap', () => {
    near(
      cheby1(2, 0.5).p,
      [
        [-0.7128, 1.004],
        [-0.7128, -1.004],
      ],
      4,
    );
    const f = cheby1(5, 0.5);
    let mx = -Infinity,
      mn = Infinity;
    for (let i = 0; i <= 2000; i++) {
      const a = attenAt(f, i / 2000);
      mx = Math.max(mx, a);
      mn = Math.min(mn, a);
    }
    expect(mx - mn).toBeCloseTo(0.5, 6);
    expect(attenAt(f, 1)).toBeCloseTo(0.5, 10);
  });

  it('チェビシェフ II: 阻止域の山はすべて As（等リップル）', () => {
    const f = cheby2(6, 40);
    let mn = Infinity;
    for (let i = 0; i <= 4000; i++) mn = Math.min(mn, attenAt(f, 1 + i / 100));
    expect(mn).toBeCloseTo(40, 4);
    expect(attenAt(f, 1)).toBeCloseTo(40, 10);
  });

  it('ベッセル: θ₄ の根、遅延を正規化した τ(0) = 1、Ω = 1 で −3.01 dB', () => {
    expect(besselPoly(3)).toEqual([15, 15, 6, 1]);
    near(
      besselDelay(4).p,
      [
        [-2.89621, 0.86723],
        [-2.89621, -0.86723],
        [-2.10379, 2.65742],
        [-2.10379, -2.65742],
      ],
      5,
    );
    for (const N of [2, 8, 14, 20]) {
      const tau = besselDelay(N).p.reduce((s, p) => s - p.re / (p.re * p.re + p.im * p.im), 0);
      expect(tau).toBeCloseTo(1, 8);
      expect(attenAt(bessel(N), 1)).toBeCloseTo(A3, 9);
    }
    /* 2 次の −3 dB の周波数は √((√45 − 3)/2) = 1.3617 */
    expect(1 / abs(bessel(2).p[0]) / (1 / abs(besselDelay(2).p[0]))).toBeCloseTo(1.36165, 5);
  });
});

describe('最小の次数（MATLAB の buttord・cheb1ord・cheb2ord・ellipord の例と同じ）', () => {
  it.each([
    ['butter', 5],
    ['cheby1', 4],
    ['cheby2', 4],
    ['ellip', 4],
  ] as [Kind, number][])('LPF fs = 1 kHz、40 Hz まで 3 dB、150 Hz から 60 dB: %s は %i 次', (kind, n) => {
    expect(design({ ...SPEC, kind }).N).toBe(n);
  });

  it.each([
    ['cheby1', 7],
    ['cheby2', 7],
    ['ellip', 5],
  ] as [Kind, number][])('BPF 60〜200 Hz・阻止域端 50・250 Hz、3 dB・40 dB: %s は %i 次', (kind, n) => {
    expect(design({ ...SPEC, kind, resp: 'bp', f1: 60, f2: 200, s1: 50, s2: 250, as: 40 }).N).toBe(n);
  });

  it('BPF 100〜200 Hz・阻止域端 50・250 Hz、3 dB・40 dB: バターワースは 8 次', () => {
    expect(design({ ...SPEC, resp: 'bp', f1: 100, f2: 200, s1: 50, s2: 250, as: 40 }).N).toBe(8);
  });

  it('上限の次数でも満たさなければ short（ベッセルの急峻な仕様）', () => {
    const r = minOrder('bessel', 1.2, 1, 80);
    expect(r).toEqual({ N: 20, exact: null, short: true });
    expect(minOrder('ellip', 1.5, 1, 60).exact).toBeGreaterThan(5);
  });
});

describe('設計（周波数変換と双一次変換）', () => {
  it('プリワーピング: f と 2fs·tan(πf/fs) は互いに戻る', () => {
    for (const f of [10, 1000, 20000]) expect(unwarp(prewarp(f, 48e3), 48e3)).toBeCloseTo(f, 9);
    /* 縮めないアナログの角周波数 2πf は、もっと低い周波数へ写る */
    expect(unwarp(2 * Math.PI * 19200, 48e3)).toBeCloseTo((48e3 / Math.PI) * Math.atan(Math.PI * 0.4), 6);
  });

  it('バターワースの LPF は fs/2 の近くでも fc でちょうど −3.01 dB（プリワーピング）', () => {
    for (const fc of [100, 5000, 19200]) {
      const D = design({ ...SPEC, mode: 'order', n: 5, f1: fc, fs: 48e3 });
      expect(respZ(D.dig, [fc], 48e3).mag[0]).toBeCloseTo(-A3, 9);
      expect(metrics(D).f3[0]).toBeCloseTo(fc, 4);
    }
    /* プリワーピングしないアナログフィルタは fc で −3.01 dB */
    const D = design({ ...SPEC, mode: 'order', n: 5, f1: 19200, fs: 48e3 });
    expect(respS(D.ana0, [19200], 48e3).mag[0]).toBeCloseTo(-A3, 9);
  });

  it('HPF・BPF・BSF の端の減衰、仕様の満たし方', () => {
    const hp = design({ ...SPEC, kind: 'cheby1', resp: 'hp', f1: 150, s1: 40, ap: 1 });
    expect(respZ(hp.dig, [150], 1000).mag[0]).toBeCloseTo(-1, 8);
    const bp = design({ ...SPEC, kind: 'ellip', resp: 'bp', f1: 60, f2: 200, s1: 50, s2: 250, as: 40 }),
      m = metrics(bp);
    expect(m.ripple).toBeCloseTo(3, 3);
    expect(m.atten).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(m.f3[0]).toBeLessThan(60);
    expect(m.f3[1]).toBeGreaterThan(200);
    const bs = design({ ...SPEC, kind: 'cheby2', resp: 'bs', f1: 50, f2: 250, s1: 100, s2: 150, ap: 1, as: 40 }),
      n = metrics(bs);
    expect(n.atten).toBeCloseTo(40, 4);
    expect(n.ripple).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('次数を指定したときの基準の端: チェビシェフ II は阻止域端、楕円は通過域端', () => {
    const c2 = design({ ...SPEC, kind: 'cheby2', mode: 'order', n: 5, f1: 100, as: 50 });
    expect(respZ(c2.dig, [100], 1000).mag[0]).toBeCloseTo(-50, 8);
    expect(c2.mask.stop).toEqual([[100, 500]]);
    const el = design({ ...SPEC, kind: 'ellip', mode: 'order', n: 5, f1: 100, ap: 1, as: 50 });
    expect(respZ(el.dig, [100], 1000).mag[0]).toBeCloseTo(-1, 8);
    expect(metrics(el).atten).toBeCloseTo(50, 4);
  });

  it('BPF の極と零点の数は 2N、零点は z = ±1 に N 個ずつ（全極の原型）', () => {
    const D = design({ ...SPEC, resp: 'bp', mode: 'order', n: 3, f1: 60, f2: 200 });
    expect(D.dig.p).toHaveLength(6);
    expect(D.dig.z.filter((z) => Math.abs(z.re - 1) < 1e-12)).toHaveLength(3);
    expect(D.dig.z.filter((z) => Math.abs(z.re + 1) < 1e-12)).toHaveLength(3);
    for (const p of D.dig.p) expect(abs(p)).toBeLessThan(1);
  });
});

describe('双2次の縦続（SOS）と直接形', () => {
  const D = design({ ...SPEC, kind: 'ellip', resp: 'bp', mode: 'order', n: 4, f1: 60, f2: 200, ap: 0.5, as: 50 });
  const f = [5, 40, 55, 61, 100, 199, 210, 300, 499];

  it('SOS・直接形・零点と極からの特性が一致する', () => {
    const z = respZ(D.dig, f, 1000);
    for (const g of ['linf', 'first'] as const)
      for (const o of ['up', 'down'] as const) {
        const s = respSOS(toSOS(D.dig, o, g), f, 1000);
        s.mag.forEach((v, i) => {
          expect(v).toBeCloseTo(z.mag[i], 8);
        });
        s.gd.forEach((v, i) => {
          expect(v).toBeCloseTo(z.gd[i], 6);
        });
      }
    const { b, a } = toBA(D.dig),
      d = respBA(b, a, f, 1000);
    d.mag.forEach((v, i) => {
      expect(v).toBeCloseTo(z.mag[i], 6);
    });
    d.ph.forEach((v, i) => {
      expect(Math.abs(((v - z.ph[i] + 540) % 360) - 180)).toBeLessThan(1e-6);
    });
  });

  it('インパルス応答: SOS と直接形の差分方程式が一致する', () => {
    const { b, a } = toBA(D.dig),
      h1 = impulseSOS(toSOS(D.dig), 300),
      h2 = impulseBA(b, a, 300);
    h1.forEach((v, i) => {
      expect(v).toBeCloseTo(h2[i], 10);
    });
  });

  it('組み方: 段は共役の極の組、up なら単位円に近い極が後ろ、linf なら途中の段の出力の最大が 0 dB', () => {
    const S = toSOS(D.dig, 'up', 'linf');
    expect(S).toHaveLength(4);
    const r = S.map((s) => abs(s.p[0]));
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThan(r[i - 1]);
    for (const s of S) expect(s.p[1].im).toBeCloseTo(-s.p[0].im, 14);
    S.slice(0, -1).forEach((s) => {
      expect(s.peak).toBeCloseTo(0, 6);
    });
    expect(S.at(-1)?.peak).toBeCloseTo(0, 3);
    /* 先頭にまとめると、途中の段の出力が小さくなる（固定小数点では SN 比が落ちる） */
    const F = toSOS(D.dig, 'up', 'first');
    expect(Math.min(...F.slice(0, -1).map((s) => s.peak))).toBeLessThan(-10);
    /* 段のゲインの積は全体のゲイン */
    expect(S.reduce((p, s) => p * s.b[0], 1)).toBeCloseTo(
      F.reduce((p, s) => p * s.b[0], 1),
      12,
    );
  });

  it('奇数次の LPF は 1 次の段を 1 つ持つ', () => {
    const L = design({ ...SPEC, mode: 'order', n: 5, f1: 100 }),
      S = toSOS(L.dig);
    expect(S).toHaveLength(3);
    expect(S.filter((s) => s.a[2] === 0 && s.b[2] === 0)).toHaveLength(1);
  });

  it('係数の丸め: 狭い BPF の 20 次の直接形は float32 でも倍精度でも不安定、SOS の極はすべて単位円の内側', () => {
    const N = design({
      ...SPEC,
      kind: 'ellip',
      resp: 'bp',
      mode: 'order',
      n: 10,
      f1: 5000,
      f2: 6300,
      ap: 0.5,
      as: 80,
      fs: 48e3,
    });
    const { a } = toBA(N.dig);
    for (const p of N.dig.p) expect(abs(p)).toBeLessThan(1);
    expect(isStable(a)).toBe(false);
    expect(isStable(a.map((x) => quantize(x, 'f32')))).toBe(false);
    expect(Math.max(...zRoots(a.map((x) => quantize(x, 'f32'))).map(abs))).toBeGreaterThan(1.1);
    /* 低い次数なら丸めても安定 */
    const L = design({ ...SPEC, mode: 'order', n: 4, f1: 1000, fs: 48e3 });
    expect(isStable(toBA(L.dig).a.map((x) => quantize(x, '6')))).toBe(true);
  });

  it('quantize: float32 と有効数字', () => {
    expect(quantize(1 / 3, 'f32')).toBe(Math.fround(1 / 3));
    expect(quantize(-1.23456789, '4')).toBe(-1.235);
    expect(quantize(0, '6')).toBe(0);
  });
});

describe('多項式と安定判別', () => {
  it('根からの展開と Aberth 法', () => {
    expect(
      fromRoots([
        { re: 1, im: 0 },
        { re: 2, im: 0 },
      ]),
    ).toEqual([1, -3, 2]);
    near(
      roots([1, -3, 2]),
      [
        [1, 0],
        [2, 0],
      ],
      12,
    );
    near(
      roots([1, 0, 1, 0]),
      [
        [0, 0],
        [0, 1],
        [0, -1],
      ],
      12,
    );
  });

  it('Schur–Cohn: 極が単位円の内側か', () => {
    expect(isStable([1, -0.5])).toBe(true);
    expect(isStable([1, -1.5])).toBe(false);
    expect(isStable([1, -1.8, 0.81])).toBe(true);
    expect(isStable([1, 0, 1.01])).toBe(false);
    expect(isStable([1, 0, 1])).toBe(false);
  });
});

describe('インパルス不変法と比べるもの', () => {
  const D = design({ ...SPEC, kind: 'cheby1', mode: 'order', n: 4, f1: 50, ap: 1 });

  it('h[n] = T·hₐ(nT)、部分分数と有理式の特性が一致する', () => {
    const pf = impinv(D.ana0, 1000),
      h = impulsePF(pf, 64),
      t = analogTime(D.ana0, 1000, 64);
    h.forEach((v, i) => {
      expect(v).toBeCloseTo(t.h[i], 12);
    });
    const f = [1, 20, 50, 120, 400],
      a = respPF(pf, f, 1000),
      { b, a: den } = pfToBA(pf),
      c = respBA(b, den, f, 1000);
    a.mag.forEach((v, i) => {
      expect(v).toBeCloseTo(c.mag[i], 8);
    });
    a.gd.forEach((v, i) => {
      expect(v).toBeCloseTo(c.gd[i], 6);
    });
    /* 低い周波数ではアナログの特性に近い */
    expect(a.mag[1]).toBeCloseTo(respS(D.ana0, [20], 1000).mag[0], 1);
  });

  it('アナログのステップ応答は直流のゲインへ収束する（偶数次のチェビシェフ I は −Ap）', () => {
    const s = analogTime(D.ana0, 1000, 2000).s;
    expect(s[1999]).toBeCloseTo(10 ** (-1 / 20), 6);
  });

  it('ベッセルの群遅延: アナログは通過域で平坦、双一次変換すると fc の近くで崩れる', () => {
    const B = design({ ...SPEC, kind: 'bessel', mode: 'order', n: 8, f1: 5000, fs: 48e3 });
    const f = [100, 2000, 4000],
      a = respS(B.ana0, f, 48e3).gd,
      d = respZ(B.dig, f, 48e3).gd;
    expect(Math.abs(a[2] - a[0]) / a[0]).toBeLessThan(0.01);
    expect(Math.abs(d[2] - d[0]) / d[0]).toBeGreaterThan(0.05);
  });
});

describe('入力の定義', () => {
  it('端の行: 隣の端を越えないように直す', () => {
    const p = edgePatch(1000, 500, 2000, 'fst1（500 Hz）', 'fst2（2 kHz）');
    expect(p.min).toBe(630);
    expect(p.max).toBe(1600);
    expect(p.fix?.(2500)).toEqual([1600, 'fst2（2 kHz） より低くするため 1.6 kHz にしました']);
    expect(p.fix?.(400)).toEqual([630, 'fst1（500 Hz） より高くするため 630 Hz にしました']);
    expect(p.fix?.(1100)).toEqual([1100, '']);
  });

  it('項目名: 次数を指定するときは近似ごとの基準の端', () => {
    expect(edgeLabel('f1', 'butter', 'lp', 'order').name).toBe('カットオフ周波数');
    expect(edgeLabel('f1', 'cheby2', 'lp', 'order').nm).toBe('fst');
    expect(edgeLabel('f2', 'ellip', 'bp', 'spec')).toMatchObject({ nm: 'fp2', name: '通過域端（上）' });
  });

  it('端の既定値: 応答・設計の方法ごとの並びの順になる', () => {
    expect(edgeDefaults('hp', 'spec')).toMatchObject({ s1: 500, f1: 1000 });
    expect(edgeDefaults('bs', 'spec')).toEqual({ f1: 1000, s1: 1600, s2: 2500, f2: 4000 });
    for (const { v } of RESPS)
      for (const m of ['order', 'spec'] as const) {
        const d = edgeDefaults(v, m),
          vs = edgeChain(v, m).map((k) => d[k]);
        for (let i = 1; i < vs.length; i++) expect(vs[i]).toBeGreaterThan(vs[i - 1]);
      }
  });

  it('次数は整数に丸める', () => {
    const n = PARAMS.find((d) => d.k === 'n');
    if (!n) throw new Error('n');
    expect(resolve(n, [], formatter(n), 4.6)).toEqual({ w: 5, why: '次数は整数のため 5 にしました' });
    expect(resolve(n, [], formatter(n), 30).w).toBe(20);
  });
});

describe('表示窓', () => {
  it('対数の横軸は f0 が左端、fs/2 が右端', () => {
    const ax = freqAxis(48e3, true, 10);
    expect(ax.X(10)).toBeCloseTo(0, 9);
    expect(ax.X(24e3)).toBeCloseTo(400, 9);
    expect(ax.F(200)).toBeCloseTo(Math.sqrt(10 * 24e3), 6);
    const lin = freqAxis(48e3, false, 10);
    expect(lin.X(12e3)).toBe(200);
  });

  it('極と零点: 重なった零点は数を添える、s 平面の範囲は極が収まる', () => {
    const D = design({ ...SPEC, mode: 'order', n: 4, f1: 100 });
    const P = pzPlot({ z: D.dig.z, p: D.dig.p, R: 1.5, plane: 'z', circle: true, lab: String });
    expect(P.marks).toContain('>4</text>');
    expect(sRange([], butter(4).p)).toBe(1.5);
  });

  it('時間応答: ほぼ正なら 0 を下から 1 div に置く', () => {
    const t = timePlot(Float64Array.from([0, 0.5, 1, 0.6, 0.2, 0]), null, 8, true);
    expect(t.zero).toBe('M0 200H400');
    expect(t.vd).toBe(0.5);
  });
});
