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
  fewPeak,
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
  return { p, f: p, fi: Uint32Array.from({ length: n + 1 }, (_, i) => i), e, k: 0 };
};
/** 反射も影もない場面 */
const FREE: Scene = { ...SCENE0, ground: 0, hillH: 0, lapse: 0 };

describe('衝撃波と N 波', () => {
  it('緩和半径 R₀ = √(E/πp₀)。E = πp₀ なら 1 m', () => {
    expect(relaxRadius(Math.PI * P0)).toBeCloseTo(1, 12);
    expect(relaxRadius(4 * Math.PI * P0)).toBeCloseTo(2, 12);
  });
  it('Few のピーク f_m = 0.63 c/R₀', () => {
    expect(fewPeak(Math.PI * P0, 340)).toBeCloseTo(0.63 * 340, 9);
  });
  it('N 波のスペクトルのピークは x = πfT ≈ 2.08（tan x = x/(1 − x²/2) の解でもある）', () => {
    expect(N_PEAK_X).toBeCloseTo(2.0816, 3);
    /* (sin x/x − cos x)/x の微分が 0: tan x (1 − x²/2) = x */
    const x = N_PEAK_X;
    expect(Math.tan(x) * (1 - (x * x) / 2) - x).toBeCloseTo(0, 6);
  });
  it('N 波の継続時間は、スペクトルのピークが Few の f_m に重なる長さ', () => {
    const e = 5e5;
    expect(nPeak(nDuration0(e, C))).toBeCloseTo(fewPeak(e, C), 6);
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
  it('N 波は遠いほど伸び、近い所（r₁ まで）は伸びない', () => {
    const s = { r1: 10, kappa: 1 };
    expect(nDuration(0.004, 5, s)).toBe(0.004);
    expect(nDuration(0.004, 10 * Math.E, s)).toBeCloseTo(0.004 * Math.SQRT2, 12);
    expect(nDuration(0.004, 1e4, s)).toBeGreaterThan(nDuration(0.004, 1e3, s));
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
  it('区間の向きの変化の平均は turn（Hill の 16°）に近く、区間の長さは lmin〜lmax', () => {
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
  it('影の領域: 曲がりの半径 R = 2T/Γ、届く距離 √(2Rz)。高さ 4 km なら約 25 km（Fleagle 1949）', () => {
    const R = bendRadius(15, 6.5);
    expect(R / 1000).toBeCloseTo(88.6, 0);
    const x = audibleRange(4000, 0, R);
    expect(x / 1000).toBeGreaterThan(24);
    expect(x / 1000).toBeLessThan(28);
  });
  it('分布の和は要素の分け方に依らない（山の高さは要素の長さに比例する）', () => {
    const ch = [line([0, 0, 0], [300, 0, 1500])],
      a = elements(ch, FREE),
      b = elements(ch, { ...FREE, stretch: { r1: 10, kappa: 6 } }),
      sum = (el: typeof a) => arrivalHistogram(el, 0, 30, 0.1)[0].reduce((x, y) => x + y, 0);
    expect(b.n).toBeLessThan(a.n);
    /* 伸びの分 T₀/T だけ下がるので、伸びの比で割って比べる */
    const k = a.p[0] / a.dl[0] / (b.p[0] / b.dl[0]);
    expect(sum(a) / (sum(b) * k)).toBeCloseTo(1, 1);
  });
});

describe('波形', () => {
  it('区間の指向性: 横から聞くと鋭い山、端の向きから聞くとなまって低い（Wright・Medendorp 1967）', () => {
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
  it('波形は光ってから最初に届く時刻の少し前から始まる', () => {
    const el = elements(makeChannel(CH0), SCENE0),
      w = render(el, SCENE0.air, FS);
    expect(w.t0).toBeLessThan(firstArrival(el));
    expect(firstArrival(el) - w.t0).toBeLessThan(0.1);
    expect(w.peak).toBeGreaterThan(0);
  });
});
