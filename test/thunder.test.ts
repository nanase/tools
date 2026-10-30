import { describe, expect, it } from 'vitest';
import { absorption, soundSpeed } from '../src/lib/air';
import { type Branch, branchLength, CH0, makeChannel, turnAngles } from '../src/tools/thunder/channel';
import {
  arrivalHistogram,
  audibleRange,
  bendRadius,
  elements,
  firstArrival,
  SCENE0,
  type Scene,
  Via,
} from '../src/tools/thunder/path';
import {
  addNWave,
  airDensity,
  fewPeak,
  LINE_G,
  N_PEAK_X,
  nDuration,
  nDuration0,
  nPeak,
  nSpectrum,
  P0,
  relaxRadius,
} from '../src/tools/thunder/shock';
import { render, spectrum } from '../src/tools/thunder/synth';

const FS = 48000,
  C = soundSpeed(20);

/** 真っすぐな折れ線 */
const line = (a: [number, number, number], b: [number, number, number], e = 5e5, n = 20): Branch => {
  const p = new Float64Array(3 * (n + 1));
  for (let k = 0; k <= n; k++) for (let j = 0; j < 3; j++) p[3 * k + j] = a[j] + ((b[j] - a[j]) * k) / n;
  return { p, e, k: 0 };
};
/** 反射も影もない場面 */
const FREE: Scene = { ...SCENE0, ground: 0, hillH: 0, lapse: 0 };

describe('衝撃波と N 波', () => {
  it('緩和半径 R₀ = √(E/πp₀)。100 kPa で 10⁴・10⁵・10⁶ J/m なら 0.18・0.56・1.78 m（Few 1986 の表 4.1）', () => {
    expect(relaxRadius(Math.PI * P0)).toBeCloseTo(1, 12);
    expect(relaxRadius(1e4, 1e5)).toBeCloseTo(0.18, 2);
    expect(relaxRadius(1e5, 1e5)).toBeCloseTo(0.56, 2);
    expect(relaxRadius(1e6, 1e5)).toBeCloseTo(1.78, 2);
  });
  it('Few のピーク f_m = 0.63 c √(p₀/E) は、学位論文の式 4.7 E ≈ 5×10⁹/f_m² の f_m と 3 % 以内で合い、10⁶ J/m で約 69 Hz', () => {
    for (const e of [1e4, 1e5, 1e6]) {
      const f = Math.sqrt(5e9 / e);
      expect(Math.abs(fewPeak(e, 343) - f) / f).toBeLessThan(0.03);
    }
    expect(fewPeak(1e6, 343)).toBeGreaterThan(65);
    expect(fewPeak(1e6, 343)).toBeLessThan(72);
    /* R₀ で書くと 0.63 c/(√π R₀) */
    expect(fewPeak(1e6, 343) * relaxRadius(1e6)).toBeCloseTo((0.63 * 343) / Math.sqrt(Math.PI), 9);
  });
  it('N 波のスペクトルのピークは x = πfT ≈ 2.08（tan x = x/(1 − x²/2) の解でもある）', () => {
    expect(N_PEAK_X).toBeCloseTo(2.0816, 3);
    /* (sin x/x − cos x)/x の微分が 0: tan x (1 − x²/2) = x */
    const x = N_PEAK_X;
    expect(Math.tan(x) * (1 - (x * x) / 2) - x).toBeCloseTo(0, 6);
  });
  it('N 波の長さは正の側 0.53 R₀ の 2 倍。1 km で 2 倍に伸びると、スペクトルのピークが Few の f_m に 15 % 以内で近い', () => {
    for (const e of [1e5, 1e6]) {
      const T0 = nDuration0(e, C);
      expect((T0 * C) / 2 / relaxRadius(e)).toBeCloseTo(0.53, 9);
      const f = nPeak(nDuration(T0, 1000));
      expect(Math.abs(f - fewPeak(e, C)) / fewPeak(e, C)).toBeLessThan(0.15);
    }
  });
  it('標本にした N 波は面積 0、正の側の面積 PT/4、DFT が式のスペクトルに合う', () => {
    const N = 1 << 14,
      T = 96.3,
      P = 2,
      y = new Float64Array(N);
    addNWave(y, 100.37, T, P);
    let sum = 0,
      pos = 0;
    for (const v of y) {
      sum += v;
      if (v > 0) pos += v;
    }
    expect(sum).toBeCloseTo(0, 9);
    expect(pos / ((P * T) / 4)).toBeCloseTo(1, 2);
    /* 区間の平均を取った分（sinc）の差は低い周波数では小さい */
    for (const k of [20, 60, 200]) {
      let re = 0,
        im = 0;
      for (let n = 0; n < N; n++) {
        re += y[n] * Math.cos((2 * Math.PI * k * n) / N);
        im -= y[n] * Math.sin((2 * Math.PI * k * n) / N);
      }
      expect(Math.hypot(re, im) / nSpectrum(k / N, T, P)).toBeCloseTo(1, 2);
    }
  });
  it('N 波は最初の 1 km で 2 倍に伸び、その先は伸びない（Few 1986）', () => {
    expect(nDuration(0.004, 10)).toBe(0.004);
    expect(nDuration(0.004, 1000)).toBeCloseTo(0.008, 12);
    expect(nDuration(0.004, 1e4)).toBeCloseTo(0.008, 12);
    let prev = 0;
    for (const r of [30, 100, 300, 999]) {
      const T = nDuration(0.004, r);
      expect(T).toBeGreaterThan(prev);
      prev = T;
    }
  });
  it('まっすぐな長い放電路の音のエネルギーは単位長さあたり ηE（円筒を通る量で確かめる）', () => {
    const e = 1e6,
      rho = 50,
      s: Scene = { ...FREE, dist: rho, ear: 0, stretch: { r1: 1, r2: 2, k: 1 } },
      w = render(elements([line([0, 0, -3000], [0, 0, 3000], e, 1)], s), s.air, FS);
    let sum = 0;
    for (const v of w.y) sum += v * v;
    const flux = (2 * Math.PI * rho * sum) / FS / (airDensity(20) * C);
    expect(flux / (s.eta * e)).toBeGreaterThan(0.85);
    expect(flux / (s.eta * e)).toBeLessThan(1.1);
    expect(LINE_G).toBeCloseTo(0.25, 4);
  });
});

describe('放電路', () => {
  it('同じ種なら同じ形、違う種なら違う形', () => {
    const a = makeChannel(CH0),
      b = makeChannel(CH0),
      c = makeChannel({ ...CH0, seed: 2 });
    expect(Array.from(a[0].p)).toEqual(Array.from(b[0].p));
    expect(Array.from(c[0].p)).not.toEqual(Array.from(a[0].p));
  });
  it('区間の向きの変化の平均は turn（Hill の 16°）に近く、区間の長さは lmin〜lmax で平均 8 m', () => {
    const all: number[] = [],
      lens: number[] = [];
    for (let s = 1; s <= 20; s++)
      for (const b of makeChannel({ ...CH0, seed: s })) {
        all.push(...turnAngles(b.p));
        for (let i = 3; i < b.p.length; i += 3)
          lens.push(Math.hypot(b.p[i] - b.p[i - 3], b.p[i + 1] - b.p[i - 2], b.p[i + 2] - b.p[i - 1]));
      }
    const mean = all.reduce((x, y) => x + y, 0) / all.length;
    expect(mean).toBeGreaterThan(14);
    expect(mean).toBeLessThan(18);
    /* 地面で止めた区間だけ短くなりうる */
    expect(lens.filter((l) => l > CH0.lmax + 1e-9).length).toBe(0);
    expect(lens.filter((l) => l < CH0.lmin - 1e-9).length / lens.length).toBeLessThan(0.01);
    expect(lens.reduce((x, y) => x + y, 0) / lens.length).toBeCloseTo(8, 0);
  });
  it('本流は地面から雲の底まで上がり、雲の中を cloud だけ進む', () => {
    const [m] = makeChannel(CH0),
      zs = m.p.filter((_, i) => i % 3 === 2);
    expect(m.p[2]).toBe(0);
    expect(Math.max(...zs)).toBeGreaterThanOrEqual(CH0.base);
    expect(branchLength(m.p)).toBeGreaterThan(CH0.base + CH0.cloud);
  });
});

describe('届く時刻', () => {
  it('真上へ伸びる放電路: 最初に届くのは根元から、dist/c 秒後（3 秒で約 1 km）', () => {
    const el = elements([line([0, 0, 0], [0, 0, 2000])], { ...FREE, dist: 1000, ear: 0 });
    expect(firstArrival(el)).toBeCloseTo(1000 / C, 3);
    expect(1000 / C).toBeGreaterThan(2.8);
    expect(1000 / C).toBeLessThan(3.0);
  });
  it('雷鳴の長さ: 高さ H の放電路は、根元と先端の距離の差 (√(d² + H²) − d)/c だけ続く', () => {
    const d = 3000,
      H = 4000,
      el = elements([line([0, 0, 0], [0, 0, H])], { ...FREE, dist: d, ear: 0 });
    expect(Math.max(...el.t) - Math.min(...el.t)).toBeCloseTo((Math.hypot(d, H) - d) / C, 1);
  });
  it('地面の反射は、鏡像の分だけ遅れて地面の反射率の大きさで届く', () => {
    const el = elements([line([0, 0, 500], [0, 0, 501], 5e5, 1)], { ...FREE, ground: 0.8, ear: 10 }),
      d = el.via.indexOf(Via.Direct),
      g = el.via.indexOf(Via.Ground);
    expect(el.t[g] - el.t[d]).toBeCloseTo((Math.hypot(3000, 510.5) - Math.hypot(3000, 490.5)) / C, 4);
    expect(el.p[g] / el.p[d]).toBeCloseTo(0.8 * (el.r[d] / el.r[g]) * 1, 1);
  });
  it('聞き手の後ろの山は、崖の高さより下で反射する部分だけこだまを返す', () => {
    const s: Scene = { ...FREE, dist: 2000, hillBack: 1000, hillH: 300, hill: 0.7 },
      el = elements([line([0, 0, 0], [0, 0, 3000], 5e5, 60)], s),
      hz = Array.from(el.via).flatMap((v, i) => (v === Via.Hill ? [el.xyz[3 * i + 2]] : []));
    expect(hz.length).toBeGreaterThan(0);
    /* 崖を横切る高さ = z·(1000/(1000 + 3000))（ear ≈ 0）。300 m 以下になるのは z ≤ 約 1200 m */
    expect(Math.max(...hz)).toBeLessThan(1250);
    /* こだまは直接の音より 2·1000/c 以上遅れる */
    const tHill = Math.min(...Array.from(el.t).filter((_, i) => el.via[i] === Via.Hill));
    expect(tHill - firstArrival(el)).toBeGreaterThanOrEqual((2 * 1000) / C - 1e-6);
  });
  it('影の領域: 届く距離 √(2Rz)、R = 2T/Γ。Fleagle の例（30 °C・9.8 K/km・5 km）で 25 km（l² = 4T₀h/Γ）', () => {
    const R = bendRadius(30, 9.8),
      x = audibleRange(5000, 0, R);
    expect(x ** 2).toBeCloseTo((4 * 303.15 * 5000) / 9.8e-3, 0);
    expect(x / 1000).toBeGreaterThan(24.5);
    expect(x / 1000).toBeLessThan(25.5);
  });
  it('分布の和は要素の分け方に依らない（山の高さは要素の長さに比例する）', () => {
    const ch = [line([0, 0, 0], [300, 0, 1500])],
      a = elements(ch, FREE),
      b = elements(ch, { ...FREE, stretch: { r1: 10, r2: 1000, k: 4 } }),
      sum = (el: typeof a) => arrivalHistogram(el, 0, 30, 0.1)[0].reduce((x, y) => x + y, 0);
    expect(b.n).toBeLessThan(a.n);
    /* 伸びの分 T₀/T だけ下がるので、伸びの比で割って比べる */
    const k = a.p[0] / a.dl[0] / (b.p[0] / b.dl[0]);
    expect(sum(a) / (sum(b) * k)).toBeCloseTo(1, 1);
  });
});

describe('波形', () => {
  it('区間の指向性: 横から聞くと鋭い山、端の向きから聞くとなまって低い（Wright・Medendorp 1968）', () => {
    const seg = [line([-50, 0, 1000], [50, 0, 1000], 5e5, 1)],
      side = render(elements(seg, { ...FREE, dist: 0, ear: 0 }), FREE.air, FS),
      end = render(elements([line([-50, 0, 0], [50, 0, 0], 5e5, 1)], { ...FREE, dist: 1000, ear: 0 }), FREE.air, FS);
    expect(side.peak / end.peak).toBeGreaterThan(5);
  });
  it('遠いほど高い音が減る（空気の吸収）', () => {
    const ch = [line([0, 0, 0], [0, 0, 2000], 5e5, 40)],
      centroid = (d: number) => {
        const w = render(elements(ch, { ...FREE, dist: d }), FREE.air, FS),
          s = spectrum(w.y, FS);
        let a = 0,
          b = 0;
        for (let k = 1; k < s.f.length; k++) {
          const p = 10 ** (s.db[k] / 10);
          a += s.f[k] * p;
          b += p;
        }
        return a / b;
      };
    const near = centroid(500),
      far = centroid(8000);
    expect(far).toBeLessThan(near * 0.7);
    /* 8 km で 1 kHz は 30 dB 以上減る */
    expect(absorption(1000) * 8000).toBeGreaterThan(30);
  });
  it('落雷（既定の放電路）を 2〜5 km で聞くと、スペクトルのピークは 20〜120 Hz（Holmes ほか 1971 の落雷の平均 50 Hz）', () => {
    const pk: number[] = [];
    for (let seed = 1; seed <= 4; seed++)
      for (const d of [2000, 5000]) {
        const s = { ...SCENE0, dist: d },
          w = render(elements(makeChannel({ ...CH0, seed }), s), s.air, FS),
          sp = spectrum(w.y, FS);
        let b = 1;
        for (let k = 1; k < sp.f.length; k++) if (sp.db[k] > sp.db[b]) b = k;
        pk.push(sp.f[b]);
      }
    const mean = pk.reduce((x, y) => x + y, 0) / pk.length;
    expect(mean).toBeGreaterThan(20);
    expect(mean).toBeLessThan(120);
  });
  it('波形は光ってから最初に届く時刻の少し前から始まる', () => {
    const el = elements(makeChannel(CH0), SCENE0),
      w = render(el, SCENE0.air, FS);
    expect(w.t0).toBeLessThan(firstArrival(el));
    expect(firstArrival(el) - w.t0).toBeLessThan(0.1);
    expect(w.peak).toBeGreaterThan(0);
  });
});
