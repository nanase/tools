import { describe, expect, it } from 'vitest';
import {
  ALPHA,
  cascade,
  DELTA,
  doublings,
  iterate,
  lyapunov,
  MAPS,
  period,
  R_INF_LOGISTIC,
  superstable,
  windowStart,
} from '../src/tools/bifurcation/map';
import { MapVoice, pitchOf, SOUND0, type SoundParams } from '../src/tools/bifurcation/sound';

const L = MAPS.logistic,
  S = MAPS.sine,
  T = MAPS.tent;

describe('ロジスティク写像の周期倍分岐', () => {
  it('周期倍分岐の位置は 3・1+√6 と Feigenbaum 定数の項の表の値に合う', () => {
    const r = doublings(L, cascade(L, 9));
    expect(r[0]).toBeCloseTo(3, 10);
    expect(r[1]).toBeCloseTo(1 + Math.sqrt(6), 10);
    /* 英語版 Wikipedia「Feigenbaum constants」の表（7 桁） */
    for (const [k, v] of [
      [2, 3.5440903],
      [3, 3.5644073],
      [4, 3.5687594],
      [5, 3.5696916],
      [6, 3.5698913],
      [7, 3.569934],
    ] as const)
      expect(r[k]).toBeCloseTo(v, 6);
  });
  it('超安定な周期 2 は 1+√5', () => {
    expect(superstable(L, 2, 3.2)).toBeCloseTo(1 + Math.sqrt(5), 12);
  });
  it('超安定な値の間隔の比は δ = 4.6692…、枝の幅の比は α = 2.5029… へ近づく', () => {
    const c = cascade(L, 11);
    expect(c.R.length).toBeGreaterThanOrEqual(11);
    expect(Math.abs(c.delta[9] - DELTA)).toBeLessThan(1e-5);
    expect(Math.abs(c.alpha[9] - ALPHA)).toBeLessThan(1e-5);
    /* 集積点（OEIS A098587 = 3.5699456718709449…） */
    expect(c.rInf).toBeCloseTo(R_INF_LOGISTIC, 11);
  });
  it('軌道の周期は 1 → 2 → 4 → 8 → 16 と倍になる', () => {
    expect([2.9, 3.2, 3.5, 3.56, 3.567].map((r) => period(L, r, 0.3))).toEqual([1, 2, 4, 8, 16]);
  });
});

describe('窓', () => {
  it('周期 3 の窓は接線分岐 r = 1 + 2√2 で始まる', () => {
    expect(windowStart(L, 3, 3.835)).toBeCloseTo(1 + 2 * Math.SQRT2, 10);
    expect(period(L, 3.835, 0.3)).toBe(3);
    /* 窓のすぐ手前は周期を持たない（間欠性） */
    expect(period(L, 3.828, 0.3)).toBe(0);
  });
  it('周期 5・7 の窓も接線分岐で始まり、その上で周期 5・7 になる', () => {
    const r5 = windowStart(L, 5, 3.739),
      r7 = windowStart(L, 7, 3.7025);
    expect(r5).toBeGreaterThan(3.738);
    expect(r5).toBeLessThan(3.739);
    expect(r7).toBeGreaterThan(3.701);
    expect(r7).toBeLessThan(3.7025);
    expect(period(L, r5 + 2e-4, 0.3)).toBe(5);
    expect(period(L, r7 + 2e-4, 0.3)).toBe(7);
  });
});

describe('リアプノフ指数', () => {
  it('r = 4 で ln 2', () => {
    expect(lyapunov(L, 4, 0.3, 1000, 1_000_000)).toBeCloseTo(Math.LN2, 3);
  });
  it('安定な周期では負、周期倍分岐の点では 0 に近い、カオスでは正', () => {
    expect(lyapunov(L, 2.9, 0.3, 2000, 20000)).toBeLessThan(0);
    expect(Math.abs(lyapunov(L, 1 + Math.sqrt(6), 0.3, 200000, 200000))).toBeLessThan(0.01);
    expect(lyapunov(L, 3.7, 0.3, 2000, 200000)).toBeGreaterThan(0.3);
    expect(lyapunov(L, 3.835, 0.3, 2000, 20000)).toBeLessThan(0);
  });
  it('テント写像は傾き μ の ln μ（μ = 2 でも 0 に落ちない）', () => {
    for (const mu of [1.2, 1.5, 1.9, 2]) expect(lyapunov(T, mu, 0.3, 1000, 200000)).toBeCloseTo(Math.log(mu), 5);
    expect(iterate(T, 2, 0.3, 10000)).toBeGreaterThan(0);
  });
});

describe('普遍性', () => {
  it('正弦写像 r sin πx も同じ δ・α に近づく', () => {
    const c = cascade(S, 11);
    expect(Math.abs(c.delta[9] - DELTA)).toBeLessThan(1e-4);
    expect(Math.abs(c.alpha[9] - ALPHA)).toBeLessThan(1e-4);
    expect(c.R[0]).toBeCloseTo(0.5, 12);
  });
  it('テント写像には滑らかな極大がないので超安定な周期を求めない', () => {
    expect(() => cascade(T, 4)).toThrow();
  });
});

/** 周波数 f の成分の大きさ（Goertzel） */
function mag(x: Float32Array, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs,
    c = 2 * Math.cos(w);
  let s1 = 0,
    s2 = 0;
  for (const v of x) {
    const s = v + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / x.length;
}

describe('値の列の音', () => {
  const fs = 48000;
  const render = (p: Partial<SoundParams>, n = fs): Float32Array => {
    const v = new MapVoice(),
      out = new Float32Array(n);
    v.set({ ...SOUND0, ...p });
    /* 過渡と高域通過の立ち上がりを捨てる */
    v.render(new Float32Array(fs / 2), fs / 2, fs);
    v.render(out, n, fs);
    return out;
  };
  it('周期 2 は rate/2、周期 4 は rate/4 の音になる（1 オクターブ下がる）', () => {
    const a = render({ r: 3.2 }),
      b = render({ r: 3.5 });
    expect(mag(a, 440, fs)).toBeGreaterThan(20 * mag(a, 220, fs));
    expect(mag(b, 220, fs)).toBeGreaterThan(0.02);
    expect(mag(b, 220, fs)).toBeGreaterThan(20 * mag(b, 110, fs));
  });
  it('固定点は音にならない', () => {
    const a = render({ r: 2.8 });
    expect(Math.max(...a.map(Math.abs))).toBeLessThan(1e-3);
  });
  it('カオスは広い帯域に散らばる', () => {
    const a = render({ r: 4 });
    for (const f of [110, 330, 600]) expect(mag(a, f, fs)).toBeGreaterThan(0.002);
  });
  it('出力は ±1 に収まる', () => {
    for (const r of [3.2, 3.83, 4]) for (const v of render({ r }, fs / 4)) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    for (const v of render({ r: 3.9, mode: 'melody', rate: 8 }, fs / 4)) expect(Math.abs(v)).toBeLessThanOrEqual(0.5);
  });
  it('旋律の高さは 0 で lo、1 で lo·2^oct、五音音階では音階の音に丸める', () => {
    const p = { lo: 220, oct: 2, scale: 'cont' as const };
    expect(pitchOf(0, p)).toBeCloseTo(220, 9);
    expect(pitchOf(1, p)).toBeCloseTo(880, 9);
    const q = { ...p, scale: 'penta' as const };
    /* 半音 5（ファ）はミ（4）へ、半音 6 はソ（7）へ（同じ近さなら下を残す） */
    expect(pitchOf(5 / 24, q)).toBeCloseTo(220 * 2 ** (4 / 12), 9);
    expect(pitchOf(6.4 / 24, q)).toBeCloseTo(220 * 2 ** (7 / 12), 9);
  });
});
